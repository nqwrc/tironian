//! The text around the caret when a dictation starts (ADR-0272).
//!
//! The person's switch is checked in the webview, which calls this once per
//! dictation; every other rule lives here, in the host:
//!
//! - One read of the element focused right now. No target and no argument,
//!   so the webview cannot point the read anywhere.
//! - The same fail-closed gate as the pasted-span read
//!   ([`crate::field_text::gate_focus`]), then a text pattern that reports a
//!   caret. A value pattern alone is refused: it has no caret and its read
//!   cannot be capped.
//! - Only three slices cross IPC: [`BEFORE_UNITS`] before the caret,
//!   [`AFTER_UNITS`] after it and [`SELECTION_UNITS`] of the selection,
//!   trimmed to whole words.
//! - Never `Err`. Nothing here logs, and nothing here touches the paste
//!   target that `field_text` keeps for correction learning.

// macOS and Linux only answer `unsupported`.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use crate::field_text::{normalize_newlines, FieldRefusal};
use serde::Serialize;

/// Code units kept before the caret, or before the selection.
pub const BEFORE_UNITS: usize = 400;
/// Code units kept after the caret, or after the selection.
pub const AFTER_UNITS: usize = 200;
/// Code units kept of the selection, from its start.
pub const SELECTION_UNITS: usize = 200;
/// How far a cut may move to land on a word boundary. Past this the text has
/// no spaces to find (Chinese, Japanese), so it is cut at the cap.
pub(crate) const WORD_SLACK: usize = 40;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CursorContextOutcome {
    Context {
        before: String,
        selection: String,
        after: String,
    },
    Refused {
        reason: FieldRefusal,
    },
}

fn is_space(unit: u16) -> bool {
    matches!(
        unit,
        0x09 | 0x0A | 0x0D | 0x20 | 0xA0 | 0x2028 | 0x2029 | 0x3000
    )
}

fn is_high_surrogate(unit: u16) -> bool {
    (0xD800..=0xDBFF).contains(&unit)
}

fn is_low_surrogate(unit: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&unit)
}

/// The text nearest the caret on its left: the last `cap` units, starting at
/// a whole word when the cut fell inside one.
pub(crate) fn clip_before(text: &[u16], cap: usize) -> Vec<u16> {
    let text = normalize_newlines(text);
    if text.len() <= cap {
        return text;
    }
    let mut start = text.len() - cap;
    if !is_space(text[start - 1]) {
        if let Some(offset) = text[start..]
            .iter()
            .take(WORD_SLACK)
            .position(|&unit| is_space(unit))
        {
            start += offset + 1;
        }
    }
    if start < text.len() && is_low_surrogate(text[start]) {
        start += 1;
    }
    text[start..].to_vec()
}

/// The text nearest the caret on its right, or the head of a selection: the
/// first `cap` units, ending at a whole word when the cut fell inside one.
pub(crate) fn clip_after(text: &[u16], cap: usize) -> Vec<u16> {
    let text = normalize_newlines(text);
    if text.len() <= cap {
        return text;
    }
    let mut end = cap;
    if !is_space(text[end]) {
        if let Some(offset) = text[..end]
            .iter()
            .rev()
            .take(WORD_SLACK)
            .position(|&unit| is_space(unit))
        {
            end -= offset + 1;
        }
    }
    if end > 0 && is_high_surrogate(text[end - 1]) {
        end -= 1;
    }
    text[..end].to_vec()
}

fn refused(reason: FieldRefusal) -> CursorContextOutcome {
    CursorContextOutcome::Refused { reason }
}

/// The text around the caret of the focused field, under the rules in the
/// module doc. The webview calls this once, at capture start, and only while
/// the person's switch is on.
#[tauri::command]
#[specta::specta]
pub async fn read_context_at_capture() -> CursorContextOutcome {
    #[cfg(target_os = "windows")]
    {
        // Cross-process COM; a hung target blocks for the UIA timeout.
        tauri::async_runtime::spawn_blocking(windows_impl::read)
            .await
            .unwrap_or(refused(FieldRefusal::PlatformError))
    }
    #[cfg(not(target_os = "windows"))]
    {
        refused(FieldRefusal::Unsupported)
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{
        clip_after, clip_before, refused, CursorContextOutcome, AFTER_UNITS, BEFORE_UNITS,
        SELECTION_UNITS,
    };
    use crate::field_text::windows_impl::{focus_facts, text_pattern, with_automation};
    use crate::field_text::{gate_focus, FieldRefusal};
    use windows::Win32::UI::Accessibility::{
        IUIAutomationTextPattern, IUIAutomationTextRange, TextPatternRangeEndpoint_End,
        TextPatternRangeEndpoint_Start, TextUnit_Character,
    };

    pub fn read() -> CursorContextOutcome {
        with_automation(|automation| {
            let Ok(element) = (unsafe { automation.GetFocusedElement() }) else {
                return refused(FieldRefusal::NoFocus);
            };
            if let Err(reason) = gate_focus(&focus_facts(automation, &element)) {
                return refused(reason);
            }
            let Some(pattern) = text_pattern(&element) else {
                return refused(FieldRefusal::NoTextPattern);
            };
            let Some(caret) = first_selection(&pattern) else {
                return refused(FieldRefusal::NoCaret);
            };
            let (Some(before), Some(selection), Some(after)) = (
                beside(&caret, Side::Before, BEFORE_UNITS),
                selected(&caret, SELECTION_UNITS),
                beside(&caret, Side::After, AFTER_UNITS),
            ) else {
                return refused(FieldRefusal::PlatformError);
            };
            CursorContextOutcome::Context {
                before: String::from_utf16_lossy(&clip_before(&before, BEFORE_UNITS)),
                selection: String::from_utf16_lossy(&clip_after(&selection, SELECTION_UNITS)),
                after: String::from_utf16_lossy(&clip_after(&after, AFTER_UNITS)),
            }
        })
        .unwrap_or(refused(FieldRefusal::PlatformError))
    }

    /// The first selection range; a caret is a degenerate one. `None` when the
    /// pattern reports none.
    fn first_selection(pattern: &IUIAutomationTextPattern) -> Option<IUIAutomationTextRange> {
        let ranges = unsafe { pattern.GetSelection() }.ok()?;
        if unsafe { ranges.Length() }.ok()? < 1 {
            return None;
        }
        unsafe { ranges.GetElement(0) }.ok()
    }

    #[derive(Clone, Copy)]
    enum Side {
        Before,
        After,
    }

    /// A UIA character can be several code units, so `units + 1` characters
    /// are read with room to spare, as `field_text`'s anchors are.
    fn read_limit(units: usize) -> i32 {
        ((units + 1) * 4) as i32
    }

    /// The text on one side of the selection, at most `units + 1` characters
    /// of it. `None` when UIA fails or the read hit its limit, which could
    /// have lost the end nearest the caret.
    fn beside(caret: &IUIAutomationTextRange, side: Side, units: usize) -> Option<Vec<u16>> {
        let range = unsafe { caret.Clone() }.ok()?;
        let step = (units + 1) as i32;
        unsafe {
            match side {
                Side::Before => {
                    range
                        .MoveEndpointByRange(
                            TextPatternRangeEndpoint_End,
                            caret,
                            TextPatternRangeEndpoint_Start,
                        )
                        .ok()?;
                    range
                        .MoveEndpointByUnit(
                            TextPatternRangeEndpoint_Start,
                            TextUnit_Character,
                            -step,
                        )
                        .ok()?;
                }
                Side::After => {
                    range
                        .MoveEndpointByRange(
                            TextPatternRangeEndpoint_Start,
                            caret,
                            TextPatternRangeEndpoint_End,
                        )
                        .ok()?;
                    range
                        .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, step)
                        .ok()?;
                }
            }
        }
        let limit = read_limit(units);
        let text = unsafe { range.GetText(limit) }.ok()?;
        if text.len() >= limit as usize {
            return None;
        }
        Some(text.to_vec())
    }

    /// The selection's head, one unit past the cap so a cut is detectable.
    fn selected(caret: &IUIAutomationTextRange, units: usize) -> Option<Vec<u16>> {
        let text = unsafe { caret.GetText((units + 1) as i32) }.ok()?;
        Some(text.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn the_caps_are_400_before_200_after_and_200_selected() {
        assert_eq!(
            (BEFORE_UNITS, AFTER_UNITS, SELECTION_UNITS),
            (400, 200, 200)
        );
    }

    #[test]
    fn short_text_is_kept_whole() {
        let before = u("Ciao Giulia, ti confermo che ");
        assert_eq!(clip_before(&before, BEFORE_UNITS), before);
        let after = u(" a presto.");
        assert_eq!(clip_after(&after, AFTER_UNITS), after);
    }

    #[test]
    fn english_before_the_caret_starts_at_a_whole_word() {
        // 48 units a sentence: the cut 400 from the end falls inside "Kubernetes".
        let text = u(&"Thanks for the notes on the Kubernetes rollout. ".repeat(13));
        let clipped = clip_before(&text, BEFORE_UNITS);
        assert!(clipped.len() <= BEFORE_UNITS);
        assert!(clipped.len() > BEFORE_UNITS - WORD_SLACK);
        assert!(text.ends_with(&clipped));
        assert_eq!(text[text.len() - clipped.len() - 1], u(" ")[0]);
    }

    #[test]
    fn italian_after_the_caret_ends_at_a_whole_word() {
        // The cut 200 from the start falls inside "domani".
        let text = u(&format!(
            "Sì, {}",
            "è già arrivata la perizia dell'avvocato Pagnoncelli, perché domani ".repeat(5)
        ));
        let clipped = clip_after(&text, AFTER_UNITS);
        assert!(clipped.len() <= AFTER_UNITS);
        assert!(clipped.len() > AFTER_UNITS - WORD_SLACK);
        assert_eq!(&text[..clipped.len()], &clipped[..]);
        assert_eq!(text[clipped.len()], u(" ")[0]);
    }

    #[test]
    fn a_long_selection_keeps_its_head() {
        let text = u(&"la riunione di giovedì ".repeat(20));
        let clipped = clip_after(&text, SELECTION_UNITS);
        assert!(clipped.len() <= SELECTION_UNITS);
        assert_eq!(&text[..clipped.len()], &clipped[..]);
    }

    #[test]
    fn a_script_without_spaces_is_cut_at_the_cap() {
        let text = u(&"漢".repeat(500));
        assert_eq!(clip_before(&text, BEFORE_UNITS).len(), BEFORE_UNITS);
        assert_eq!(clip_after(&text, AFTER_UNITS).len(), AFTER_UNITS);
    }

    #[test]
    fn a_cut_never_splits_a_surrogate_pair() {
        // 601 units: the cut 400 from the end lands on a low surrogate.
        let before = clip_before(&u(&format!("{}x", "😀".repeat(300))), BEFORE_UNITS);
        assert!(String::from_utf16(&before).is_ok());
        assert_eq!(before.len(), BEFORE_UNITS - 1);
        // The cut 200 from the start lands after a high surrogate.
        let after = clip_after(&u(&format!("x{}", "😀".repeat(300))), AFTER_UNITS);
        assert!(String::from_utf16(&after).is_ok());
        assert_eq!(after.len(), AFTER_UNITS - 1);
    }

    #[test]
    fn line_breaks_become_lf() {
        assert_eq!(
            clip_before(&u("Dear Ann,\r\n"), BEFORE_UNITS),
            u("Dear Ann,\n")
        );
        assert_eq!(
            clip_after(&u("\r\nBest, Ann"), AFTER_UNITS),
            u("\nBest, Ann")
        );
    }

    #[test]
    fn outcomes_serialize_with_a_kind_tag() {
        let context = CursorContextOutcome::Context {
            before: "a".into(),
            selection: String::new(),
            after: "c".into(),
        };
        assert_eq!(
            serde_json::to_string(&context).unwrap(),
            r#"{"kind":"context","before":"a","selection":"","after":"c"}"#
        );
        assert_eq!(
            serde_json::to_string(&refused(FieldRefusal::NoCaret)).unwrap(),
            r#"{"kind":"refused","reason":"noCaret"}"#
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn other_platforms_refuse_every_read() {
        assert_eq!(
            tauri::async_runtime::block_on(read_context_at_capture()),
            refused(FieldRefusal::Unsupported)
        );
    }

    /// Nothing above the tests may log, or reach the paste target that
    /// correction learning owns.
    #[test]
    fn this_module_neither_logs_nor_touches_the_paste_target() {
        let source = include_str!("cursor_context.rs");
        let body = source.split("#[cfg(test)]").next().unwrap();
        for forbidden in [
            "log::",
            "tracing::",
            "println!",
            "eprintln!",
            "dbg!",
            "info!(",
            "warn!(",
            "error!(",
            "debug!(",
            "take_read",
            "target_slot",
            "keep_anchors",
            "begin_delivery",
            "clear_target",
        ] {
            assert!(!body.contains(forbidden), "{forbidden}");
        }
    }
}
