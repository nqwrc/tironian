//! Native transcript delivery and synthetic keyboard commands for Tironian.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
// `state` is the only thing this brings in, and the sole caller is the macOS
// dictation-capability check below. Ungated it warns on every Windows and Linux
// build, which the desktop CI job compiles.
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Where `write_text` left the transcript.
#[derive(Clone, Copy, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WriteTextOutcome {
    /// The synthetic paste landed at the cursor.
    Pasted,
    /// Delivery could not paste, so the transcript remains on the clipboard.
    LeftOnClipboard,
}

/// Gives the freshly built event tap a moment to start before posting paste.
const PRE_PASTE_SETTLE: std::time::Duration = std::time::Duration::from_millis(50);

/// Held after the paste is posted, before this command returns.
///
/// Nothing to do with the clipboard. The frontend posts the optional Enter
/// keystroke the moment `write_text` resolves, and Enter is only safe once the
/// target has actually applied the paste: a composer that handles paste
/// asynchronously would otherwise submit an empty message and take the
/// transcript with it. Delivery used to get this gap for free from the restore
/// it awaited inline; the restore is deferred now, so the gap has to be stated.
const POST_PASTE_SETTLE: std::time::Duration = std::time::Duration::from_millis(100);

/// How long the borrowed transcript stays on the clipboard before the restore.
///
/// Not a guess at how fast a paste is consumed: that cannot be measured without
/// owning the clipboard through delayed rendering. It is a ceiling wide enough
/// that a cold Electron main thread, a loaded machine, or an RDP round trip has
/// drained the keystroke first. The restore no longer blocks the command's
/// return, so widening it costs the user nothing they can see.
const RESTORE_DELAY: std::time::Duration = std::time::Duration::from_millis(1500);

/// The clipboard state a borrow hands back: the full-fidelity macOS pasteboard
/// capture, or the previous text (if any) everywhere else.
#[cfg(target_os = "macos")]
type ClipboardRestoreState = crate::clipboard::ClipboardSnapshot;
#[cfg(not(target_os = "macos"))]
type ClipboardRestoreState = Option<String>;

/// Issues the id that tells one borrow from the next.
static NEXT_BORROW: AtomicU64 = AtomicU64::new(1);

/// The clipboard borrow that has not been handed back yet, if there is one.
///
/// Shared state rather than three values moved into the restore task, because
/// the next dictation has to be able to read it. Once the restore is deferred
/// past this command's return, a second dictation inside the window sees a
/// clipboard holding the first one's transcript. Snapshotting that as "the
/// user's clipboard" would destroy the real one: the first restore is cancelled
/// (its transcript is gone) and the second later stamps a transcript back as if
/// the user had put it there. So a dictation that finds a live borrow takes it
/// over and owes back what it owed, and only the newest borrow can ever fire.
static PENDING_BORROW: Mutex<Option<PendingBorrow>> = Mutex::new(None);

/// A transcript sitting on the clipboard with the user's content owed back.
struct PendingBorrow {
    /// Which borrow this is. A restore that wakes to find a different id in the
    /// slot is looking at a later dictation's borrow, not at its own.
    generation: u64,
    /// Clipboard change token sampled the instant after the transcript was
    /// written, when the platform has one. See [`clipboard_changed_hands`].
    token: Option<u64>,
    /// The transcript left on the clipboard, for the platforms that answer
    /// [`clipboard_changed_hands`] by comparing content instead.
    transcript: String,
    /// What goes back when this borrow ends.
    snapshot: ClipboardRestoreState,
}

/// Recovers from poisoning instead of propagating it. Nothing held under this
/// lock can panic, and taking the process down over a clipboard bookkeeping
/// slot would be a far worse outcome than any failure it could be reporting.
fn pending_borrow() -> MutexGuard<'static, Option<PendingBorrow>> {
    PENDING_BORROW
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Delivers text to the cursor, falling back to the clipboard when it cannot.
///
/// With `keep_on_clipboard`, the transcript is the intended final clipboard
/// state. Otherwise this command borrows the clipboard, pastes, and schedules
/// the previous contents to go back: the exact previous macOS pasteboard, or
/// the previous text on other platforms, clearing instead when there was no
/// previous text, so the borrowed transcript never lingers.
///
/// That restore is deferred past this command's return and is conditional. It
/// does not fire when a later dictation has taken the borrow over (that one
/// hands the same content back instead), nor when the clipboard has visibly
/// changed hands while borrowed, where stamping a stale snapshot over newer
/// content is the worse loss. A path that means to leave the transcript on the
/// clipboard, the reach fallback and `keep_on_clipboard`, ends the borrow
/// without a restore at all.
#[tauri::command]
#[specta::specta]
pub async fn write_text(
    app: tauri::AppHandle,
    text: String,
    keep_on_clipboard: bool,
) -> Result<WriteTextOutcome, String> {
    #[cfg(target_os = "macos")]
    let can_paste = {
        use crate::keyboard::{DictationCapability, TapController};
        app.state::<TapController>().capability() == DictationCapability::Active
    };
    // Windows UIPI drops injected input aimed above our own integrity level
    // without saying so, so an unchecked paste into an elevated window reports
    // success and inserts nothing. Sampled here rather than beside
    // `simulate_paste`, which is `PRE_PASTE_SETTLE` later: the same drift the
    // macOS grant check already accepts, and moving it down would duplicate the
    // clipboard fallback into two branches to buy 50ms of accuracy.
    #[cfg(target_os = "windows")]
    let can_paste = crate::foreground::foreground_accepts_synthetic_input();
    // X11 and Wayland have no UIPI equivalent and no cheap analogue to probe,
    // so there is nothing here to gate on.
    #[cfg(target_os = "linux")]
    let can_paste = true;

    if !can_paste {
        app.clipboard()
            .write_text(&text)
            .map_err(|error| format!("Failed to write to clipboard: {error}"))?;
        // The transcript is the clipboard's contents from here on, so a borrow
        // still outstanding has nothing left to hand back and must not stamp
        // its snapshot over this fallback. Ended after the write and never
        // before: a write that failed leaves that borrow describing the
        // clipboard accurately and still worth returning.
        pending_borrow().take();
        return Ok(WriteTextOutcome::LeftOnClipboard);
    }

    if keep_on_clipboard {
        app.clipboard()
            .write_text(&text)
            .map_err(|error| format!("Failed to write to clipboard: {error}"))?;
        // Clipboard output is on, so the transcript is the intended final
        // clipboard state. Same ordering, same reason, as the fallback above.
        pending_borrow().take();

        tokio::time::sleep(PRE_PASTE_SETTLE).await;
        if simulate_paste().is_err() {
            return Ok(WriteTextOutcome::LeftOnClipboard);
        }
        tokio::time::sleep(POST_PASTE_SETTLE).await;
        return Ok(WriteTextOutcome::Pasted);
    }

    // Whether a live borrow is still holding the clipboard, decided before this
    // dictation overwrites it and acted on after. A live borrow means the text
    // sitting there is the previous dictation's transcript, not the user's
    // content, so it must not be snapshotted; the borrow's own snapshot is what
    // this dictation will owe back.
    let inheriting = {
        let slot = pending_borrow();
        slot.as_ref()
            .is_some_and(|pending| !clipboard_changed_hands(&app, pending))
    };
    let captured = (!inheriting).then(|| capture_clipboard(&app));

    #[cfg(target_os = "macos")]
    if !crate::clipboard::write_concealed(&text) {
        return Err("Failed to write to clipboard".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    app.clipboard()
        .write_text(&text)
        .map_err(|error| format!("Failed to write to clipboard: {error}"))?;
    let token = clipboard_change_token();

    // The write landed, so this dictation owns the clipboard and takes over
    // whatever borrow it displaced. A stale borrow (the clipboard had already
    // changed hands) is dropped here too: its transcript is long gone.
    let displaced = pending_borrow().take();
    let snapshot = match displaced {
        Some(pending) if inheriting => pending.snapshot,
        _ => captured.unwrap_or_else(|| capture_clipboard(&app)),
    };

    tokio::time::sleep(PRE_PASTE_SETTLE).await;
    if simulate_paste().is_err() {
        // The transcript stays put as the fallback, so nothing is owed back.
        // Dropping `snapshot` here is the loss this branch has always accepted.
        return Ok(WriteTextOutcome::LeftOnClipboard);
    }

    let generation = NEXT_BORROW.fetch_add(1, Ordering::SeqCst);
    *pending_borrow() = Some(PendingBorrow {
        generation,
        token,
        transcript: text,
        snapshot,
    });
    spawn_clipboard_restore(app, generation);

    tokio::time::sleep(POST_PASTE_SETTLE).await;
    Ok(WriteTextOutcome::Pasted)
}

/// The clipboard state to hand back when a borrow ends.
fn capture_clipboard(app: &tauri::AppHandle) -> ClipboardRestoreState {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        crate::clipboard::snapshot()
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.clipboard().read_text().ok()
    }
}

/// A number that changes when, and only when, the clipboard's contents change.
/// `None` where no such counter is read, which sends callers to a content
/// comparison instead.
fn clipboard_change_token() -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
        // SAFETY: no arguments, no out parameters, no handle to own. The call
        // reads a counter belonging to this window station.
        let sequence = unsafe { GetClipboardSequenceNumber() };
        // Zero is the documented failure value (a window station with no
        // clipboard access at all), not a number worth comparing against.
        (sequence != 0).then_some(u64::from(sequence))
    }
    // macOS exposes the same counter as `NSPasteboard.changeCount` and reading
    // it here would be the same improvement. It is not wired up because the
    // content comparison below is already decisive there: the pasteboard has no
    // exclusive open to contend for, so a text read that fails is evidence that
    // something non-text took it, never evidence that we were locked out. X11
    // and Wayland expose nothing equivalent.
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Whether the clipboard has left our hands since the transcript was written.
///
/// Windows answers this exactly. The clipboard sequence number moves on every
/// change and on nothing else, so a number that has not moved proves the
/// borrowed transcript is still what the clipboard holds, and a number that has
/// moved proves something replaced it, including the user deliberately copying
/// the identical text. Reading it also takes no clipboard lock, so the answer
/// survives a clipboard manager or an RDP session holding the clipboard open,
/// which a text read would not: arboard gives up after five attempts 5ms apart.
///
/// Elsewhere the question is answered by content, and a text read that fails
/// counts as changed hands for the reason [`clipboard_change_token`] gives.
///
/// Residue worth naming: a clipboard manager that rewrites the clipboard with
/// the same text it just observed moves the sequence number, and this then
/// leaves the transcript behind rather than restoring over it. Leaving a
/// transcript is the direction this whole guard errs in.
fn clipboard_changed_hands(app: &tauri::AppHandle, pending: &PendingBorrow) -> bool {
    if let (Some(written), Some(now)) = (pending.token, clipboard_change_token()) {
        return written != now;
    }
    app.clipboard().read_text().ok().as_deref() != Some(pending.transcript.as_str())
}

/// Hands the clipboard back once the paste has had time to land.
///
/// Detached rather than awaited for two reasons. The wait can be wide enough to
/// actually cover a slow target, which an awaited sleep could not be. And a
/// restore failure can no longer turn a landed paste into an `Err`, which the
/// frontend read as a reduced reach and answered by copying the transcript back
/// to the clipboard, undoing the borrow this whole path exists to perform.
fn spawn_clipboard_restore(app: tauri::AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(RESTORE_DELAY).await;

        let pending = {
            let mut slot = pending_borrow();
            match slot.take() {
                // Ours, and it ends here whichever way the guard below goes.
                Some(pending) if pending.generation == generation => pending,
                // A later dictation took the borrow over and owes the user
                // their content now, or a path that means to leave a transcript
                // on the clipboard ended it. Either way this one owes nothing.
                other => {
                    *slot = other;
                    return;
                }
            }
        };

        if clipboard_changed_hands(&app, &pending) {
            // Somebody else owns the clipboard now: the user pressed Ctrl+C, or
            // a manager rewrote it. Stamping the snapshot over content newer
            // than it is a worse loss than a transcript left behind.
            log::debug!("Clipboard changed hands while borrowed; leaving it alone");
            return;
        }

        #[cfg(target_os = "macos")]
        crate::clipboard::restore(&pending.snapshot);
        #[cfg(not(target_os = "macos"))]
        {
            let restored = match &pending.snapshot {
                // There was previous text: put it back.
                Some(content) => app.clipboard().write_text(content),
                // Nothing readable as text was there before (empty, or non-text
                // content this platform can't snapshot): clear rather than leave
                // the transcript behind. `read_text` errors in both cases, so
                // `None` doesn't distinguish them, but leaving the borrowed
                // transcript on the clipboard is wrong either way.
                None => app.clipboard().clear(),
            };
            if let Err(error) = restored {
                // Logged, never returned: the paste already landed, so failing
                // the command here would tell the frontend the transcript never
                // reached the cursor. The cost of this branch is a transcript
                // left on the clipboard, which is where a reduced reach would
                // have put it anyway.
                log::warn!("Failed to restore clipboard after paste: {error}");
            }
        }
    });
}

/// Posts a synthetic paste with layout-independent key codes.
fn simulate_paste() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (modifier, v_key) = (Key::Meta, Key::Other(9));
    #[cfg(target_os = "windows")]
    let (modifier, v_key) = (Key::Control, Key::Other(0x56));
    #[cfg(target_os = "linux")]
    let (modifier, v_key) = (Key::Control, Key::Unicode('v'));

    let press_modifier = enigo.key(modifier, Direction::Press);
    let press_v = enigo.key(v_key, Direction::Press);
    let release_v = enigo.key(v_key, Direction::Release);
    let release_modifier = enigo.key(modifier, Direction::Release);
    press_modifier
        .and(press_v)
        .and(release_v)
        .and(release_modifier)
        .map_err(|error| format!("Failed to simulate paste: {error}"))
}

/// Simulates pressing the Enter/Return key.
#[tauri::command]
#[specta::specta]
pub async fn simulate_enter_keystroke() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    enigo
        .key(Key::Return, Direction::Click)
        .map_err(|error| format!("Failed to simulate Enter key: {error}"))?;
    Ok(())
}

/// Simulates the platform copy shortcut with layout-independent key codes.
///
/// Refuses on Windows when injected input cannot reach the foreground window,
/// the same gate `write_text` applies to the paste. The copy needs it more.
/// A dropped paste loses a transcript that is still on the clipboard, while a
/// dropped copy produces a plausible wrong answer: `captureSelection` posts the
/// copy, waits, then reads the clipboard, so a copy UIPI swallowed hands back
/// whatever the user already had there as if they had selected it, and that
/// text goes on to a transformation provider. Enter and Backspace need no such
/// gate: Enter follows a paste already proved reachable, and backspaces that go
/// nowhere leave the text visibly undeleted rather than answering wrongly.
#[tauri::command]
#[specta::specta]
pub async fn simulate_copy_keystroke() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if !crate::foreground::foreground_accepts_synthetic_input() {
        return Err(
            "Windows blocked the copy: the focused window runs with higher privileges than Tironian, so its selection cannot be read."
                .to_string(),
        );
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let (modifier, c_key) = (Key::Meta, Key::Other(8));
    #[cfg(target_os = "windows")]
    let (modifier, c_key) = (Key::Control, Key::Other(0x43));
    #[cfg(target_os = "linux")]
    let (modifier, c_key) = (Key::Control, Key::Unicode('c'));

    enigo
        .key(modifier, Direction::Press)
        .map_err(|error| format!("Failed to press modifier key: {error}"))?;
    enigo
        .key(c_key, Direction::Press)
        .map_err(|error| format!("Failed to press C key: {error}"))?;
    enigo
        .key(c_key, Direction::Release)
        .map_err(|error| format!("Failed to release C key: {error}"))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|error| format!("Failed to release modifier key: {error}"))?;

    Ok(())
}

/// The most backspaces one undo may send.
///
/// Matches the Snippets replacement cap. Without it a five-minute dictation
/// would fire thousands of synthetic keystrokes into whatever holds focus, and
/// a partial delete is worse than a refusal: nobody can tell how far it got.
const MAX_BACKSPACES: u32 = 2000;

/// Simulates pressing Backspace `count` times.
///
/// One press deletes one grapheme cluster, so the caller counts graphemes, not
/// UTF-16 code units. Refuses above the cap rather than deleting part of it.
#[tauri::command]
#[specta::specta]
pub async fn simulate_backspaces(count: u32) -> Result<(), String> {
    if count > MAX_BACKSPACES {
        return Err(format!(
            "Refusing to send {count} backspaces: the limit is {MAX_BACKSPACES}."
        ));
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    for _ in 0..count {
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|error| format!("Failed to simulate Backspace: {error}"))?;
    }
    Ok(())
}
