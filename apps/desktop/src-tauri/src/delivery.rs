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
///
/// Refuses on Windows when injected input cannot reach the foreground window,
/// like `write_text` and the copy keystroke. After a paste the check repeats one
/// `write_text` already passed, but a spoken "press enter" alone sends Enter with
/// no paste before it, and UIPI would drop that key without an error.
#[tauri::command]
#[specta::specta]
pub async fn simulate_enter_keystroke() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if !crate::foreground::foreground_accepts_synthetic_input() {
        return Err(
            "Windows blocked Enter: the focused window runs with higher privileges than Tironian."
                .to_string(),
        );
    }

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
/// text goes on to a transformation provider. Enter has the same gate
/// (`simulate_enter_keystroke`). Backspace needs none: backspaces that go
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

/// How often `wait_for_modifiers_released` re-reads the keyboard.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
const MODIFIER_POLL: std::time::Duration = std::time::Duration::from_millis(10);

/// The longest a caller can make `wait_for_modifiers_released` wait. A chord
/// that has not lifted after a second is a held key, not a slow release.
#[cfg(any(target_os = "windows", target_os = "macos"))]
const MAX_MODIFIER_WAIT_MS: u32 = 1000;

/// Whether every sampled `GetAsyncKeyState` result reads "up".
///
/// Bit 15 is "down now". Bit 0 is "pressed since the last call", which says
/// nothing about the present, so a state of `1` counts as released.
#[cfg(any(target_os = "windows", test))]
fn all_released(states: &[i16]) -> bool {
    states.iter().all(|state| (*state as u16 & 0x8000) == 0)
}

/// Whether a macOS `CGEventFlags` mask holds none of the four modifiers a
/// synthetic Cmd+V would inherit: shift, control, option and command. Caps lock
/// and the other flag bits do not change what the keystroke means.
#[cfg(any(target_os = "macos", test))]
fn mac_modifiers_released(flags: u64) -> bool {
    const SHIFT: u64 = 0x0002_0000;
    const CONTROL: u64 = 0x0004_0000;
    const OPTION: u64 = 0x0008_0000;
    const COMMAND: u64 = 0x0010_0000;
    flags & (SHIFT | CONTROL | OPTION | COMMAND) == 0
}

/// Poll `modifiers_down` until it reads false or `timeout` passes. Returns
/// whether the modifiers lifted in time. It reads once before it looks at the
/// clock, so a zero timeout still answers for the present moment.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
async fn wait_until_released(
    timeout: std::time::Duration,
    poll: std::time::Duration,
    mut modifiers_down: impl FnMut() -> bool,
) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if !modifiers_down() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(poll).await;
    }
}

#[cfg(target_os = "windows")]
fn modifiers_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    let states = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .map(|key| unsafe { GetAsyncKeyState(i32::from(key.0)) });
    !all_released(&states)
}

#[cfg(target_os = "macos")]
fn modifiers_down() -> bool {
    // `core-graphics` 0.22 does not wrap this call, so declare it, as
    // `keyboard::mac_tap` does for the event tap. The CoreGraphics framework is
    // already linked. State id 0 is `kCGEventSourceStateCombinedSessionState`:
    // the keys down across the whole login session, hardware and synthetic.
    extern "C" {
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    !mac_modifiers_released(unsafe { CGEventSourceFlagsState(COMBINED_SESSION_STATE) })
}

/// Waits, bounded, until Ctrl, Shift, Alt and Win (Control, Shift, Option and
/// Command on macOS) are all up, so a synthetic Ctrl/Cmd+V or Ctrl/Cmd+C sent
/// from a global chord does not inherit the chord's modifiers. The webview
/// cannot see the global keyboard state, so the wait runs here.
///
/// Returns whether the modifiers lifted within `timeout_ms` (capped at one
/// second). The caller decides what to do when they did not. Platforms with no
/// modifier read answer `true` at once.
#[tauri::command]
#[specta::specta]
pub async fn wait_for_modifiers_released(timeout_ms: u32) -> bool {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let timeout =
            std::time::Duration::from_millis(u64::from(timeout_ms.min(MAX_MODIFIER_WAIT_MS)));
        wait_until_released(timeout, MODIFIER_POLL, modifiers_down).await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = timeout_ms;
        true
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn keys_up_read_as_released() {
        assert!(all_released(&[0, 0]));
    }

    #[test]
    fn a_key_down_now_is_not_released() {
        assert!(!all_released(&[0, i16::MIN]));
    }

    #[test]
    fn the_pressed_since_last_call_bit_is_not_down() {
        assert!(all_released(&[1, 0]));
    }

    #[test]
    fn each_mac_modifier_counts_and_caps_lock_does_not() {
        assert!(mac_modifiers_released(0));
        for flag in [0x0002_0000u64, 0x0004_0000, 0x0008_0000, 0x0010_0000] {
            assert!(!mac_modifiers_released(flag));
        }
        assert!(mac_modifiers_released(0x0001_0000), "caps lock alone");
    }

    #[tokio::test]
    async fn a_chord_that_lifts_in_time_answers_true() {
        let mut reads = 0;
        let lifted =
            wait_until_released(Duration::from_millis(500), Duration::from_millis(1), || {
                reads += 1;
                reads < 4
            })
            .await;
        assert!(lifted);
        assert_eq!(reads, 4);
    }

    #[tokio::test]
    async fn a_chord_that_never_lifts_answers_false_at_the_deadline() {
        let started = std::time::Instant::now();
        let lifted =
            wait_until_released(Duration::from_millis(30), Duration::from_millis(5), || true).await;
        assert!(!lifted);
        assert!(started.elapsed() >= Duration::from_millis(30));
    }

    #[tokio::test]
    async fn zero_timeout_still_reads_the_keyboard_once() {
        assert!(wait_until_released(Duration::ZERO, Duration::from_millis(5), || false).await);
        assert!(!wait_until_released(Duration::ZERO, Duration::from_millis(5), || true).await);
    }
}
