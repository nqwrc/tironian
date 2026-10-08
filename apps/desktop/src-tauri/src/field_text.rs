//! Reading around the text Tironian pasted (ADR-0271).
//!
//! Field text is a larger data class than anything `foreground` touches, so
//! every rule lives here, in the host, next to the code that must obey it:
//!
//! - No target, no read. `write_text` records a [`PasteTarget`] only when its
//!   caller asks to observe, and every other delivery, Enter or backspace
//!   clears it. A target expires [`OBSERVATION_WINDOW`] after the paste and
//!   allows [`READ_BUDGET`] reads.
//! - Fail-closed, the opposite of the secure-field guard. [`gate`] refuses
//!   before any text pattern is queried, in the order it states.
//! - Only a span crosses IPC: up to [`ANCHOR_UNITS`] code units either side of
//!   the paste and the region between, at most [`region_cap`] units. The
//!   webview never sends a search string.
//! - Never `Err`. Every failure is a `Refused { reason }`.
//! - Nothing here logs text. Between reads the target keeps the delivered
//!   text, which is Tironian's own output, and two anchors.

// Used from `write_text` (Task 3) and the read command (Task 4). Remove this
// line in Task 4.
#![allow(dead_code)]
// macOS and Linux only clear targets and answer `unsupported`.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// A field longer than this is refused rather than read into host memory.
pub const MAX_FIELD_TEXT_UTF16: usize = 100_000;
/// A delivery longer than this is a document, not a dictation worth watching.
pub const MAX_DELIVERED_UTF16: usize = 4_000;
/// Context kept on each side of the paste to find it again.
pub const ANCHOR_UNITS: usize = 32;
/// How long after the paste a read may run.
pub const OBSERVATION_WINDOW: Duration = Duration::from_secs(90);
/// The baseline, its retry, three timer checks, and the next-dictation check.
pub const READ_BUDGET: u8 = 6;

/// The largest region a read returns. Between two anchors, past this the
/// person was writing, not correcting. An empty anchor means the paste touched
/// that end of the field and the region runs to it, so typing on there is held
/// to one anchor's worth: a respelling and a word fit, a typed reply does not.
pub(crate) fn region_cap(delivered_units: usize, anchors: &Anchors) -> usize {
    if anchors.before.is_empty() || anchors.after.is_empty() {
        delivered_units + ANCHOR_UNITS
    } else {
        2 * delivered_units + 200
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FieldRefusal {
    /// This platform has no field read.
    Unsupported,
    /// No live paste target: none recorded, expired, or its reads spent.
    NoTarget,
    /// No focused element, or one the OS will not identify.
    NoFocus,
    /// The focused element belongs to Tironian itself.
    OwnWindow,
    /// UIPI: the element's process sits above Tironian's integrity level.
    Unreachable,
    /// A password field, or one whose password state could not be read.
    Secure,
    /// A denylisted app or a console or terminal window, or one whose app id
    /// or window classes could not be read.
    Denied,
    /// Neither an Edit nor a Document control.
    NotATextField,
    /// Not the element Tironian pasted into.
    Moved,
    /// The element exposes neither a text pattern nor a value pattern.
    NoTextPattern,
    /// The pasted text, or an anchor, is not in the field exactly once.
    NotFound,
    /// The field or the region is over its cap.
    TooLong,
    /// COM or UI Automation failed.
    PlatformError,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FieldReadOutcome {
    Span {
        before: String,
        region: String,
        after: String,
    },
    Refused {
        reason: FieldRefusal,
    },
}

impl FieldReadOutcome {
    pub(crate) fn refused(reason: FieldRefusal) -> Self {
        Self::Refused { reason }
    }
}

/// The element a paste landed in: its UIA RuntimeId and its process.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ElementId {
    pub runtime_id: Vec<i32>,
    pub process_id: u32,
}

/// The context either side of the paste, kept inside the target.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Anchors {
    pub before: Vec<u16>,
    pub after: Vec<u16>,
}

/// What one observation may read, and nothing more.
#[derive(Clone, Debug)]
pub(crate) struct PasteTarget {
    pub generation: u64,
    pub element: ElementId,
    /// The delivered text in UTF-16, newlines normalized to `\n`.
    pub delivered: Vec<u16>,
    pub deadline: Instant,
    pub reads_left: u8,
    /// Set by the first read that finds the delivered text.
    pub anchors: Option<Anchors>,
}

/// What the host learned about the focused element, before touching any text.
#[derive(Debug, Default)]
pub(crate) struct FocusFacts {
    pub element: Option<ElementId>,
    pub own_process: bool,
    pub reachable: bool,
    pub app_id: Option<String>,
    /// `None` when `CurrentIsPassword` failed.
    pub is_password: Option<bool>,
    /// `None` when `CurrentControlType` failed.
    pub control_type: Option<i32>,
    /// Class names of the focused element, its ancestors up to the first one
    /// with a window, that window, and its top-level window. `None` when any
    /// of them could not be read.
    pub window_classes: Option<Vec<String>>,
}

/// `UIA_EditControlTypeId` and `UIA_DocumentControlTypeId`
/// (`windows-0.62.2/src/Windows/Win32/UI/Accessibility/mod.rs:20368,20343`),
/// written out so the gate builds and tests on every platform.
const EDIT_CONTROL: i32 = 50004;
const DOCUMENT_CONTROL: i32 = 50030;

/// Apps whose text is never read, whatever they expose. Terminals put their
/// scrollback, printed tokens included, behind a text pattern; password
/// managers hold secrets; a remote session's field belongs to another machine.
const DENIED_APPS: &[&str] = &[
    "windowsterminal.exe",
    "openconsole.exe",
    "conhost.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "wezterm-gui.exe",
    "wezterm.exe",
    "alacritty.exe",
    "keepass.exe",
    "keepassxc.exe",
    "1password.exe",
    "bitwarden.exe",
    "mstsc.exe",
];

pub(crate) fn is_denied_app(app_id: &str) -> bool {
    DENIED_APPS.contains(&app_id)
}

/// Console and terminal windows, whatever program runs in them. A classic
/// console can report its client (`ssh.exe`, `python.exe`) as the element's
/// process, which no exe list covers, so the windows themselves are checked:
/// conhost's window, the pseudo-console window, Windows Terminal's top-level
/// window, and its terminal control.
const CONSOLE_CLASSES: &[&str] = &[
    "ConsoleWindowClass",
    "PseudoConsoleWindow",
    "CASCADIA_HOSTING_WINDOW_CLASS",
    "TermControl",
];

/// Window class names compare without regard to case, as Win32 does.
pub(crate) fn is_console_class(class: &str) -> bool {
    CONSOLE_CLASSES
        .iter()
        .any(|known| known.eq_ignore_ascii_case(class))
}

/// The refusal order is the contract. Every check runs before any text
/// pattern is queried; the target itself is checked before this runs.
pub(crate) fn gate(facts: &FocusFacts, expected: &ElementId) -> Result<(), FieldRefusal> {
    let Some(element) = &facts.element else {
        return Err(FieldRefusal::NoFocus);
    };
    if facts.own_process {
        return Err(FieldRefusal::OwnWindow);
    }
    if !facts.reachable {
        return Err(FieldRefusal::Unreachable);
    }
    if facts.is_password != Some(false) {
        return Err(FieldRefusal::Secure);
    }
    match &facts.app_id {
        Some(app_id) if !is_denied_app(app_id) => {}
        _ => return Err(FieldRefusal::Denied),
    }
    match &facts.window_classes {
        Some(classes) if !classes.iter().any(|class| is_console_class(class)) => {}
        _ => return Err(FieldRefusal::Denied),
    }
    if !matches!(facts.control_type, Some(EDIT_CONTROL | DOCUMENT_CONTROL)) {
        return Err(FieldRefusal::NotATextField);
    }
    if element != expected {
        return Err(FieldRefusal::Moved);
    }
    Ok(())
}

/// `\r\n` and a lone `\r` become `\n`, so UIA text and the delivery compare.
pub(crate) fn normalize_newlines(text: &[u16]) -> Vec<u16> {
    const CR: u16 = 0x0D;
    const LF: u16 = 0x0A;
    let mut out = Vec::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        if text[index] == CR {
            out.push(LF);
            if text.get(index + 1) == Some(&LF) {
                index += 1;
            }
        } else {
            out.push(text[index]);
        }
        index += 1;
    }
    out
}

/// A target for a delivery, or `None` when it is empty or too long to watch.
pub(crate) fn new_target(
    generation: u64,
    element: ElementId,
    delivered: &str,
    now: Instant,
) -> Option<PasteTarget> {
    let delivered = normalize_newlines(&delivered.encode_utf16().collect::<Vec<_>>());
    if delivered.is_empty() || delivered.len() > MAX_DELIVERED_UTF16 {
        return None;
    }
    Some(PasteTarget {
        generation,
        element,
        delivered,
        deadline: now + OBSERVATION_WINDOW,
        reads_left: READ_BUDGET,
        anchors: None,
    })
}

/// Spends one read. `None`, and the slot emptied, once the target expired or
/// its budget is gone.
pub(crate) fn take_read(slot: &mut Option<PasteTarget>, now: Instant) -> Option<PasteTarget> {
    let target = slot.as_mut()?;
    if now >= target.deadline || target.reads_left == 0 {
        *slot = None;
        return None;
    }
    target.reads_left -= 1;
    Some(target.clone())
}

/// Keeps the first read's anchors, only for the same delivery and only once.
pub(crate) fn keep_anchors(slot: &mut Option<PasteTarget>, generation: u64, anchors: Anchors) {
    if let Some(target) = slot
        .as_mut()
        .filter(|target| target.generation == generation && target.anchors.is_none())
    {
        target.anchors = Some(anchors);
    }
}

/// The one live target, if any.
static TARGET: Mutex<Option<PasteTarget>> = Mutex::new(None);
/// Counts deliveries, so a capture that finishes late cannot arm a target
/// over a newer delivery.
static DELIVERIES: AtomicU64 = AtomicU64::new(0);

/// Recovers from poisoning: nothing held under this lock can panic.
fn target_slot() -> MutexGuard<'static, Option<PasteTarget>> {
    TARGET
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Called first in every `write_text`. Whatever was observed is no longer the
/// last thing Tironian put in a field. Returns the generation `arm` needs.
pub(crate) fn begin_delivery() -> u64 {
    let generation = DELIVERIES.fetch_add(1, Ordering::SeqCst) + 1;
    *target_slot() = None;
    generation
}

/// A synthetic Enter or backspace, or the frontend closing its observation.
pub(crate) fn clear_target() {
    *target_slot() = None;
}

/// Records the target unless a later delivery has begun since `generation`.
pub(crate) fn arm(generation: u64, element: ElementId, delivered: &str, now: Instant) {
    let mut slot = target_slot();
    if DELIVERIES.load(Ordering::SeqCst) != generation {
        return;
    }
    *slot = new_target(generation, element, delivered, now);
}

pub(crate) fn take_read_now() -> Option<PasteTarget> {
    take_read(&mut target_slot(), Instant::now())
}

pub(crate) fn keep_anchors_now(generation: u64, anchors: Anchors) {
    keep_anchors(&mut target_slot(), generation, anchors);
}

/// A located span in UTF-16, before it is converted for IPC.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Span {
    pub before: Vec<u16>,
    pub region: Vec<u16>,
    pub after: Vec<u16>,
}

impl Span {
    pub(crate) fn into_outcome(self) -> FieldReadOutcome {
        FieldReadOutcome::Span {
            before: String::from_utf16_lossy(&self.before),
            region: String::from_utf16_lossy(&self.region),
            after: String::from_utf16_lossy(&self.after),
        }
    }

    pub(crate) fn anchors(&self) -> Anchors {
        Anchors {
            before: self.before.clone(),
            after: self.after.clone(),
        }
    }
}

fn find_from(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() || from > haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| at + from)
}

/// The start of the only match; `None` for none or several. Overlapping
/// matches count.
fn find_once(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    let at = find_from(haystack, needle, 0)?;
    find_from(haystack, needle, at + 1).is_none().then_some(at)
}

/// The first read: the delivered text must occur exactly once. The reference
/// search, used whenever `FindText` cannot answer.
pub(crate) fn locate_delivered(field: &[u16], delivered: &[u16]) -> Result<Span, FieldRefusal> {
    let field = normalize_newlines(field);
    let at = find_once(&field, delivered).ok_or(FieldRefusal::NotFound)?;
    let end = at + delivered.len();
    Ok(Span {
        before: field[at.saturating_sub(ANCHOR_UNITS)..at].to_vec(),
        region: field[at..end].to_vec(),
        after: field[end..(end + ANCHOR_UNITS).min(field.len())].to_vec(),
    })
}

/// Later reads: what sits between the anchors now.
pub(crate) fn locate_region(
    field: &[u16],
    anchors: &Anchors,
    delivered_units: usize,
) -> Result<Span, FieldRefusal> {
    let field = normalize_newlines(field);
    let before = normalize_newlines(&anchors.before);
    let after = normalize_newlines(&anchors.after);
    let start = if before.is_empty() {
        0
    } else {
        find_once(&field, &before).ok_or(FieldRefusal::NotFound)? + before.len()
    };
    let end = if after.is_empty() {
        field.len()
    } else {
        find_from(&field, &after, start).ok_or(FieldRefusal::NotFound)?
    };
    if end - start > region_cap(delivered_units, anchors) {
        return Err(FieldRefusal::TooLong);
    }
    Ok(Span {
        before,
        region: field[start..end].to_vec(),
        after,
    })
}

/// Longest a paste waits for its focused-element capture before giving up on
/// observing. The capture runs in parallel with the paste's own settle time.
const CAPTURE_TIMEOUT: Duration = Duration::from_millis(500);

/// A focused-element capture started before a paste and finished after it.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) struct PendingCapture {
    #[cfg(target_os = "windows")]
    element: tauri::async_runtime::JoinHandle<Option<ElementId>>,
    delivered: String,
    generation: u64,
}

/// Starts capturing the focused element when `write_text` was asked to
/// observe. Captured before the paste because the paste lands wherever focus
/// is at that instant.
pub(crate) fn begin_capture(observe: bool, generation: u64, text: &str) -> Option<PendingCapture> {
    #[cfg(target_os = "windows")]
    {
        if !observe || text.encode_utf16().count() > MAX_DELIVERED_UTF16 {
            return None;
        }
        Some(PendingCapture {
            // Cross-process COM: a hung target blocks for the UIA timeout.
            element: tauri::async_runtime::spawn_blocking(windows_impl::capture_focused_element),
            delivered: text.to_owned(),
            generation,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (observe, generation, text);
        None
    }
}

/// After a successful paste: records the target, or nothing when the capture
/// failed, timed out, or a later delivery has begun.
pub(crate) async fn finish_capture(pending: Option<PendingCapture>) {
    #[cfg(target_os = "windows")]
    if let Some(pending) = pending {
        if let Ok(Ok(Some(element))) = tokio::time::timeout(CAPTURE_TIMEOUT, pending.element).await
        {
            arm(
                pending.generation,
                element,
                &pending.delivered,
                Instant::now(),
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = pending;
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::ElementId;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Ole::{
        SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement};

    /// Runs `body` with COM initialized on this thread and a UIA client. Every
    /// COM object `body` touches is dropped before `CoUninitialize`. `None`
    /// when either step fails.
    pub fn with_automation<T>(body: impl FnOnce(&IUIAutomation) -> T) -> Option<T> {
        // S_FALSE (already initialized) also counts as success and still needs
        // the matching CoUninitialize, as in `foreground::focused_field_kind`.
        if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
            return None;
        }
        let automation: windows::core::Result<IUIAutomation> =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) };
        let result = automation.ok().map(|automation| body(&automation));
        unsafe { CoUninitialize() };
        result
    }

    /// The focused element's identity, for `write_text` to record.
    pub fn capture_focused_element() -> Option<ElementId> {
        with_automation(|automation| {
            let element = unsafe { automation.GetFocusedElement() }.ok()?;
            element_id(&element)
        })
        .flatten()
    }

    pub fn element_id(element: &IUIAutomationElement) -> Option<ElementId> {
        let process_id = u32::try_from(unsafe { element.CurrentProcessId() }.ok()?)
            .ok()
            .filter(|id| *id != 0)?;
        Some(ElementId {
            runtime_id: runtime_id(element)?,
            process_id,
        })
    }

    fn runtime_id(element: &IUIAutomationElement) -> Option<Vec<i32>> {
        let array = unsafe { element.GetRuntimeId() }.ok()?;
        if array.is_null() {
            return None;
        }
        let parts = (|| -> Option<Vec<i32>> {
            let lower = unsafe { SafeArrayGetLBound(array, 1) }.ok()?;
            let upper = unsafe { SafeArrayGetUBound(array, 1) }.ok()?;
            let mut parts = Vec::with_capacity((upper - lower + 1).max(0) as usize);
            for index in lower..=upper {
                let mut value = 0i32;
                unsafe { SafeArrayGetElement(array, &index, (&mut value as *mut i32).cast()) }
                    .ok()?;
                parts.push(value);
            }
            Some(parts)
        })();
        let _ = unsafe { SafeArrayDestroy(array) };
        parts.filter(|parts| !parts.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn expected() -> ElementId {
        ElementId {
            runtime_id: vec![42, 1234, 5],
            process_id: 7,
        }
    }

    fn readable() -> FocusFacts {
        FocusFacts {
            element: Some(expected()),
            own_process: false,
            reachable: true,
            app_id: Some("code.exe".into()),
            is_password: Some(false),
            control_type: Some(EDIT_CONTROL),
            window_classes: Some(vec!["RichEditD2DPT".into(), "Notepad".into()]),
        }
    }

    #[test]
    fn the_pasted_into_plain_field_passes() {
        assert_eq!(gate(&readable(), &expected()), Ok(()));
        let document = FocusFacts {
            control_type: Some(DOCUMENT_CONTROL),
            ..readable()
        };
        assert_eq!(gate(&document, &expected()), Ok(()));
    }

    #[test]
    fn no_element_is_no_focus() {
        let facts = FocusFacts {
            element: None,
            ..readable()
        };
        assert_eq!(gate(&facts, &expected()), Err(FieldRefusal::NoFocus));
    }

    #[test]
    fn ownership_and_reach_refuse_before_the_password_state() {
        let own = FocusFacts {
            own_process: true,
            is_password: Some(true),
            ..readable()
        };
        assert_eq!(gate(&own, &expected()), Err(FieldRefusal::OwnWindow));
        let elevated = FocusFacts {
            reachable: false,
            is_password: Some(true),
            ..readable()
        };
        assert_eq!(gate(&elevated, &expected()), Err(FieldRefusal::Unreachable));
    }

    #[test]
    fn a_password_field_or_an_unknown_state_is_secure() {
        let password = FocusFacts {
            is_password: Some(true),
            ..readable()
        };
        assert_eq!(gate(&password, &expected()), Err(FieldRefusal::Secure));
        let unknown = FocusFacts {
            is_password: None,
            ..readable()
        };
        assert_eq!(gate(&unknown, &expected()), Err(FieldRefusal::Secure));
    }

    #[test]
    fn secure_outranks_a_moved_element() {
        // A password field in another element must say Secure, not Moved.
        let facts = FocusFacts {
            is_password: Some(true),
            element: Some(ElementId {
                runtime_id: vec![42, 9, 9],
                process_id: 7,
            }),
            ..readable()
        };
        assert_eq!(gate(&facts, &expected()), Err(FieldRefusal::Secure));
    }

    #[test]
    fn denied_and_unknown_apps_refuse() {
        for app in [
            "windowsterminal.exe",
            "conhost.exe",
            "pwsh.exe",
            "keepassxc.exe",
            "1password.exe",
            "bitwarden.exe",
            "mstsc.exe",
        ] {
            let facts = FocusFacts {
                app_id: Some(app.into()),
                ..readable()
            };
            assert_eq!(
                gate(&facts, &expected()),
                Err(FieldRefusal::Denied),
                "{app}"
            );
        }
        let unknown = FocusFacts {
            app_id: None,
            ..readable()
        };
        assert_eq!(gate(&unknown, &expected()), Err(FieldRefusal::Denied));
    }

    #[test]
    fn console_and_terminal_windows_refuse_by_class_whatever_the_exe() {
        // `ssh.exe` is on no exe list; its console window gives it away.
        for class in [
            "ConsoleWindowClass",
            "PseudoConsoleWindow",
            "CASCADIA_HOSTING_WINDOW_CLASS",
            "TermControl",
            "consolewindowclass",
        ] {
            let facts = FocusFacts {
                app_id: Some("ssh.exe".into()),
                window_classes: Some(vec![String::new(), class.into()]),
                ..readable()
            };
            assert_eq!(
                gate(&facts, &expected()),
                Err(FieldRefusal::Denied),
                "{class}"
            );
        }
        let unknown = FocusFacts {
            window_classes: None,
            ..readable()
        };
        assert_eq!(gate(&unknown, &expected()), Err(FieldRefusal::Denied));
    }

    #[test]
    fn only_edit_and_document_controls_pass() {
        let button = FocusFacts {
            control_type: Some(50000),
            ..readable()
        };
        assert_eq!(gate(&button, &expected()), Err(FieldRefusal::NotATextField));
        let unknown = FocusFacts {
            control_type: None,
            ..readable()
        };
        assert_eq!(
            gate(&unknown, &expected()),
            Err(FieldRefusal::NotATextField)
        );
    }

    #[test]
    fn another_element_or_another_process_is_moved() {
        let other_element = FocusFacts {
            element: Some(ElementId {
                runtime_id: vec![42, 9, 9],
                process_id: 7,
            }),
            ..readable()
        };
        assert_eq!(gate(&other_element, &expected()), Err(FieldRefusal::Moved));
        let other_process = FocusFacts {
            element: Some(ElementId {
                runtime_id: vec![42, 1234, 5],
                process_id: 8,
            }),
            ..readable()
        };
        assert_eq!(gate(&other_process, &expected()), Err(FieldRefusal::Moved));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn control_type_constants_match_the_windows_crate() {
        use windows::Win32::UI::Accessibility::{UIA_DocumentControlTypeId, UIA_EditControlTypeId};
        assert_eq!(EDIT_CONTROL, UIA_EditControlTypeId.0);
        assert_eq!(DOCUMENT_CONTROL, UIA_DocumentControlTypeId.0);
    }

    #[test]
    fn newlines_normalize_to_lf() {
        assert_eq!(normalize_newlines(&u("a\r\nb\rc\nd")), u("a\nb\nc\nd"));
    }

    #[test]
    fn a_target_allows_six_reads_then_none() {
        let now = Instant::now();
        let mut slot = new_target(1, expected(), "Deploy it on cubernetes tonight", now);
        for _ in 0..READ_BUDGET {
            assert!(take_read(&mut slot, now).is_some());
        }
        assert!(take_read(&mut slot, now).is_none());
        assert!(slot.is_none());
    }

    #[test]
    fn an_expired_target_is_dropped() {
        let now = Instant::now();
        let mut slot = new_target(1, expected(), "Deploy it on cubernetes tonight", now);
        assert!(take_read(&mut slot, now + OBSERVATION_WINDOW).is_none());
        assert!(slot.is_none());
    }

    #[test]
    fn an_empty_or_oversized_delivery_arms_nothing() {
        let now = Instant::now();
        assert!(new_target(1, expected(), "", now).is_none());
        assert!(new_target(1, expected(), &"x".repeat(MAX_DELIVERED_UTF16 + 1), now).is_none());
        assert!(new_target(1, expected(), &"x".repeat(MAX_DELIVERED_UTF16), now).is_some());
    }

    #[test]
    fn the_target_keeps_a_newline_normalized_delivery() {
        let target = new_target(1, expected(), "Dear Ann,\r\nsee you", Instant::now()).unwrap();
        assert_eq!(target.delivered, u("Dear Ann,\nsee you"));
    }

    #[test]
    fn anchors_are_kept_once_and_only_for_the_same_delivery() {
        let mut slot = new_target(
            3,
            expected(),
            "Deploy it on cubernetes tonight",
            Instant::now(),
        );
        let first = Anchors {
            before: u("Note: "),
            after: u(" End."),
        };
        keep_anchors(&mut slot, 2, first.clone());
        assert_eq!(slot.as_ref().unwrap().anchors, None);
        keep_anchors(&mut slot, 3, first.clone());
        keep_anchors(&mut slot, 3, Anchors::default());
        assert_eq!(slot.as_ref().unwrap().anchors, Some(first));
    }

    /// The only test that touches the process-wide slot.
    #[test]
    fn a_later_delivery_voids_an_earlier_arm() {
        let text = "Deploy it on cubernetes tonight";
        let first = begin_delivery();
        let second = begin_delivery();
        arm(first, expected(), text, Instant::now());
        assert!(take_read_now().is_none());
        arm(second, expected(), text, Instant::now());
        assert!(take_read_now().is_some());
        clear_target();
        assert!(take_read_now().is_none());
    }

    #[test]
    fn outcomes_serialize_with_a_kind_tag() {
        let span = FieldReadOutcome::Span {
            before: "a".into(),
            region: "b".into(),
            after: String::new(),
        };
        assert_eq!(
            serde_json::to_string(&span).unwrap(),
            r#"{"kind":"span","before":"a","region":"b","after":""}"#
        );
        assert_eq!(
            serde_json::to_string(&FieldReadOutcome::refused(FieldRefusal::NoTarget)).unwrap(),
            r#"{"kind":"refused","reason":"noTarget"}"#
        );
    }

    const DELIVERED: &str = "Ho aggiornato il ticket su gira.";

    #[test]
    fn anchors_keep_32_units_each_side_and_nothing_else() {
        let field = format!("{} {DELIVERED} {}", "x".repeat(50), "y".repeat(50));
        let span = locate_delivered(&u(&field), &u(DELIVERED)).unwrap();
        assert_eq!(span.before, u(&format!("{} ", "x".repeat(31))));
        assert_eq!(span.region, u(DELIVERED));
        assert_eq!(span.after, u(&format!(" {}", "y".repeat(31))));
    }

    #[test]
    fn a_paste_at_the_end_of_the_field_has_an_empty_after_anchor() {
        let span = locate_delivered(&u(&format!("Ciao, {DELIVERED}")), &u(DELIVERED)).unwrap();
        assert_eq!(span.before, u("Ciao, "));
        assert!(span.after.is_empty());
    }

    #[test]
    fn two_copies_of_the_paste_are_not_found() {
        let field = format!("{DELIVERED} {DELIVERED}");
        assert_eq!(
            locate_delivered(&u(&field), &u(DELIVERED)),
            Err(FieldRefusal::NotFound)
        );
    }

    #[test]
    fn crlf_in_the_field_matches_lf_in_the_delivery() {
        let span = locate_delivered(
            &u("Dear Ann,\r\nsee you at nine\r\nBye"),
            &u("see you at nine"),
        )
        .unwrap();
        assert_eq!(span.before, u("Dear Ann,\n"));
        assert_eq!(span.after, u("\nBye"));
    }

    #[test]
    fn the_region_is_what_sits_between_the_anchors_now() {
        let anchors = Anchors {
            before: u("Ciao, "),
            after: u(" A dopo."),
        };
        let field = u("Ciao, Ho aggiornato il ticket su Jira. A dopo.");
        let span = locate_region(&field, &anchors, u(DELIVERED).len()).unwrap();
        assert_eq!(span.region, u("Ho aggiornato il ticket su Jira."));
        assert_eq!(span.before, anchors.before);
        assert_eq!(span.after, anchors.after);
    }

    #[test]
    fn an_empty_after_anchor_runs_to_the_end_of_the_field() {
        let anchors = Anchors {
            before: u("Ciao, "),
            after: Vec::new(),
        };
        let span =
            locate_region(&u("Ciao, Ho aggiornato il ticket su Jira."), &anchors, 32).unwrap();
        assert_eq!(span.region, u("Ho aggiornato il ticket su Jira."));
    }

    #[test]
    fn a_lost_or_repeated_before_anchor_is_not_found() {
        let anchors = Anchors {
            before: u("Ciao, "),
            after: Vec::new(),
        };
        assert_eq!(
            locate_region(&u("Hello there"), &anchors, 10),
            Err(FieldRefusal::NotFound)
        );
        assert_eq!(
            locate_region(&u("Ciao, a. Ciao, b."), &anchors, 10),
            Err(FieldRefusal::NotFound)
        );
    }

    #[test]
    fn between_two_anchors_the_region_may_reach_twice_the_paste_plus_200() {
        let anchors = Anchors {
            before: u("A "),
            after: u(" Z"),
        };
        assert_eq!(region_cap(10, &anchors), 220);
        let at_cap = format!("A {} Z", "m".repeat(220));
        assert!(locate_region(&u(&at_cap), &anchors, 10).is_ok());
        let over = format!("A {} Z", "m".repeat(221));
        assert_eq!(
            locate_region(&u(&over), &anchors, 10),
            Err(FieldRefusal::TooLong)
        );
    }

    #[test]
    fn next_to_an_empty_anchor_the_region_may_grow_by_one_anchor_only() {
        let at_end = Anchors {
            before: u("A "),
            after: Vec::new(),
        };
        assert_eq!(region_cap(10, &at_end), 10 + ANCHOR_UNITS);
        let fits = format!("A {}", "z".repeat(10 + ANCHOR_UNITS));
        assert!(locate_region(&u(&fits), &at_end, 10).is_ok());
        let over = format!("A {}", "z".repeat(10 + ANCHOR_UNITS + 1));
        assert_eq!(
            locate_region(&u(&over), &at_end, 10),
            Err(FieldRefusal::TooLong)
        );
        let at_start = Anchors {
            before: Vec::new(),
            after: u(" Z"),
        };
        assert_eq!(region_cap(10, &at_start), 10 + ANCHOR_UNITS);
        let over = format!("{} Z", "z".repeat(10 + ANCHOR_UNITS + 1));
        assert_eq!(
            locate_region(&u(&over), &at_start, 10),
            Err(FieldRefusal::TooLong)
        );
    }

    #[test]
    fn a_reply_typed_after_a_paste_at_the_end_never_crosses_ipc() {
        // A chat box or an email body that held only the paste.
        let alone = Anchors::default();
        let delivered = u("Ci vediamo domani con Nicolas.").len();
        let fixed = u("Ci vediamo domani con Nicola e");
        assert_eq!(
            locate_region(&fixed, &alone, delivered).unwrap().region,
            fixed
        );
        let reply = format!(
            "Ci vediamo domani con Nicola e {}",
            "poi parliamo del progetto. ".repeat(8)
        );
        assert_eq!(
            locate_region(&u(&reply), &alone, delivered),
            Err(FieldRefusal::TooLong)
        );
    }

    #[test]
    fn a_span_becomes_three_strings() {
        let span = Span {
            before: u("a"),
            region: u("b"),
            after: u("c"),
        };
        assert_eq!(
            span.into_outcome(),
            FieldReadOutcome::Span {
                before: "a".into(),
                region: "b".into(),
                after: "c".into()
            }
        );
    }
}
