//! Modifier-only push-to-talk on Windows (ADR-0246).
//!
//! `RegisterHotKey`, which `tauri-plugin-global-shortcut` sits on, binds one
//! key plus modifiers and has no modifier-only form, so a Ctrl+Win hold can
//! never be a plugin chord. On Windows a low-level keyboard hook sees that hold
//! with no permission grant. That asymmetry is why this exists on Windows only:
//! on macOS the same hold needs the Accessibility grant, which shortcuts do not
//! ask for.
//!
//! The hook observes and never swallows. Every key event continues to Windows
//! and the foreground app unchanged, so Ctrl+Win+D still makes a desktop. The
//! hook keeps which modifiers are down and nothing else: no key identity leaves
//! the hook thread beyond "a modifier" or "some other key".
//!
//! Layering:
//! - `HoldTracker` the pure decision core, unit-tested on every platform
//! - `platform`    the Windows hook thread and the worker that emits triggers

use serde::Deserialize;

/// A modifier a hold is made of. Left and right collapse, as in chords.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, specta::Type)]
pub enum HoldModifier {
    Control,
    Alt,
    Shift,
    Super,
}

impl HoldModifier {
    const fn bit(self) -> u8 {
        match self {
            Self::Control => CONTROL,
            Self::Alt => ALT,
            Self::Shift => SHIFT,
            Self::Super => SUPER,
        }
    }
}

/// One command bound to a modifier-only hold, beside the plugin chords.
#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModifierHoldRegistration {
    pub command_id: String,
    pub modifiers: Vec<HoldModifier>,
}

const CONTROL: u8 = 1;
const ALT: u8 = 1 << 1;
const SHIFT: u8 = 1 << 2;
const SUPER: u8 = 1 << 3;

/// The modifier set a registration names, refusing a hold of fewer than two
/// modifiers: a single held Ctrl or Shift is part of nearly every chord, so it
/// would start a recording on ordinary typing.
pub(crate) fn mask_of(registration: &ModifierHoldRegistration) -> Result<u8, String> {
    let mask = registration
        .modifiers
        .iter()
        .fold(0, |mask, modifier| mask | modifier.bit());
    if mask.count_ones() < 2 {
        return Err(format!(
            "the hold for {} needs at least two modifiers",
            registration.command_id
        ));
    }
    Ok(mask)
}

/// A trigger edge the tracker decided on.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Transition {
    /// The registered hold is down and nothing else is. `masks_start_menu` is
    /// set when the hold includes Win: releasing Win after a press with no key
    /// in between opens Start, so the caller taps an unassigned key while Win
    /// is still down.
    Pressed {
        command_id: String,
        masks_start_menu: bool,
    },
    Released {
        command_id: String,
    },
}

enum KeyClass {
    Modifier { bit: u8, right: bool },
    Other,
}

// Virtual-key codes. The low-level hook reports sided codes; the generic ones
// only arrive from odd drivers, and count as the left key.
const VK_SHIFT: u32 = 0x10;
const VK_CONTROL: u32 = 0x11;
const VK_MENU: u32 = 0x12;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LMENU: u32 = 0xA4;
const VK_RMENU: u32 = 0xA5;

fn classify(vk: u32) -> KeyClass {
    let (bit, right) = match vk {
        VK_CONTROL | VK_LCONTROL => (CONTROL, false),
        VK_RCONTROL => (CONTROL, true),
        VK_MENU | VK_LMENU => (ALT, false),
        VK_RMENU => (ALT, true),
        VK_SHIFT | VK_LSHIFT => (SHIFT, false),
        VK_RSHIFT => (SHIFT, true),
        VK_LWIN => (SUPER, false),
        VK_RWIN => (SUPER, true),
        _ => return KeyClass::Other,
    };
    KeyClass::Modifier { bit, right }
}

/// The sided virtual key for one tracked side bit, for the physical check.
fn vk_of(bit: u8, right: bool) -> u32 {
    match (bit, right) {
        (CONTROL, false) => VK_LCONTROL,
        (CONTROL, true) => VK_RCONTROL,
        (ALT, false) => VK_LMENU,
        (ALT, true) => VK_RMENU,
        (SHIFT, false) => VK_LSHIFT,
        (SHIFT, true) => VK_RSHIFT,
        (SUPER, false) => VK_LWIN,
        _ => VK_RWIN,
    }
}

/// Decides Pressed and Released from the physical key stream.
///
/// A hold presses when its exact modifier set becomes down with no other key
/// pressed since the first modifier went down, and releases on anything that
/// breaks it: a modifier up, an extra modifier, or another key. After a break
/// nothing re-arms until every modifier is up, so Ctrl+Win+D is a desktop
/// gesture and never a second recording.
pub(crate) struct HoldTracker {
    targets: Vec<(u8, String)>,
    /// Held sides: bits 0-3 left, 4-7 right, in the `CONTROL`..`SUPER` order.
    sides: u8,
    /// Something other than a clean hold happened since the first modifier
    /// went down.
    spent: bool,
    active: Option<(u8, String)>,
}

impl HoldTracker {
    pub(crate) fn new(targets: Vec<(u8, String)>) -> Self {
        Self {
            targets,
            sides: 0,
            spent: false,
            active: None,
        }
    }

    fn held(&self) -> u8 {
        (self.sides & 0x0F) | (self.sides >> 4)
    }

    /// Swap the registered holds. An active hold whose registration is gone is
    /// released, so a rebind mid-hold cannot strand a recording.
    pub(crate) fn set_targets(&mut self, targets: Vec<(u8, String)>) -> Option<Transition> {
        self.targets = targets;
        let (mask, command_id) = self.active.take()?;
        if self
            .targets
            .iter()
            .any(|(target, id)| *target == mask && *id == command_id)
        {
            self.active = Some((mask, command_id));
            return None;
        }
        self.spent = true;
        Some(Transition::Released { command_id })
    }

    /// Feed one physical key event. `is_down` answers whether a sided virtual
    /// key is physically down right now; it clears modifiers whose key-up the
    /// hook never saw, which happens when the secure desktop (Win+L, UAC) takes
    /// the release.
    pub(crate) fn on_key(
        &mut self,
        vk: u32,
        down: bool,
        is_down: &dyn Fn(u32) -> bool,
    ) -> Option<Transition> {
        let (bit, right) = match classify(vk) {
            KeyClass::Other => {
                if down && self.sides != 0 {
                    self.spent = true;
                    return self.release();
                }
                return None;
            }
            KeyClass::Modifier { bit, right } => (bit, right),
        };
        let side = if right { bit << 4 } else { bit };
        if down {
            self.forget_released_sides(side, is_down);
            if self.sides & !side == 0 {
                // The first modifier of a new sequence.
                self.spent = false;
            }
            self.sides |= side;
        } else {
            self.sides &= !side;
        }

        if self.held() == 0 {
            self.spent = false;
            return self.release();
        }

        if let Some((mask, _)) = &self.active {
            if *mask == self.held() {
                // Auto-repeat of a held modifier.
                return None;
            }
            self.spent = true;
            return self.release();
        }

        if !down || self.spent {
            return None;
        }
        let held = self.held();
        let (mask, command_id) = self
            .targets
            .iter()
            .find(|(mask, _)| *mask == held)
            .cloned()?;
        self.active = Some((mask, command_id.clone()));
        Some(Transition::Pressed {
            command_id,
            masks_start_menu: mask & SUPER != 0,
        })
    }

    fn release(&mut self) -> Option<Transition> {
        let (_, command_id) = self.active.take()?;
        Some(Transition::Released { command_id })
    }

    /// Drop every tracked side except `pressed` whose key is not physically
    /// down. `pressed` just arrived, so its async state may not be updated yet.
    /// Runs on every modifier press, so a stale side can neither complete a
    /// hold nor keep the sequence spent.
    fn forget_released_sides(&mut self, pressed: u8, is_down: &dyn Fn(u32) -> bool) {
        for index in 0..8u8 {
            let side = 1 << index;
            if side == pressed || self.sides & side == 0 {
                continue;
            }
            let (bit, right) = if index < 4 {
                (side, false)
            } else {
                (side >> 4, true)
            };
            if !is_down(vk_of(bit, right)) {
                self.sides &= !side;
            }
        }
    }
}

#[cfg(windows)]
pub(crate) use platform::replace;

/// Off Windows there is no hook: a hold registration is refused so the caller
/// never believes a gesture is live when it cannot fire.
#[cfg(not(windows))]
pub(crate) fn replace(_app: &tauri::AppHandle, targets: Vec<(u8, String)>) -> Result<(), String> {
    if targets.is_empty() {
        Ok(())
    } else {
        Err("modifier-only shortcuts are only available on Windows".into())
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{self, Sender};
    use std::sync::{Arc, Mutex};
    use std::thread;

    use tauri::AppHandle;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
        HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    use super::{HoldTracker, Transition};
    use crate::shell::{emit_shortcut_trigger, GlobalShortcutState};

    /// An unassigned virtual key, the same one AutoHotkey masks Win with. A
    /// tap of it between Win down and Win up tells the shell Win was used as a
    /// modifier, so Start stays closed.
    const VK_START_MENU_MASK: u16 = 0xE8;

    /// The hook procedure has no context argument, so its one outlet is here.
    static EVENTS: Mutex<Option<Sender<(u32, bool)>>> = Mutex::new(None);
    static RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);

    struct Runtime {
        hook_thread: u32,
        tracker: Arc<Mutex<HoldTracker>>,
    }

    /// Install, update, or remove the hook so it runs exactly while a hold is
    /// registered.
    pub(crate) fn replace(app: &AppHandle, targets: Vec<(u8, String)>) -> Result<(), String> {
        let mut runtime = RUNTIME
            .lock()
            .map_err(|_| "modifier hold runtime lock poisoned".to_string())?;
        if targets.is_empty() {
            if let Some(current) = runtime.take() {
                let released = current
                    .tracker
                    .lock()
                    .ok()
                    .and_then(|mut tracker| tracker.set_targets(Vec::new()));
                stop(&current);
                if let Some(transition) = released {
                    apply(app, transition);
                }
            }
            return Ok(());
        }
        if let Some(current) = runtime.as_ref() {
            let released = current
                .tracker
                .lock()
                .map_err(|_| "modifier hold tracker lock poisoned".to_string())?
                .set_targets(targets);
            if let Some(transition) = released {
                apply(app, transition);
            }
            return Ok(());
        }
        *runtime = Some(start(app.clone(), targets)?);
        Ok(())
    }

    fn start(app: AppHandle, targets: Vec<(u8, String)>) -> Result<Runtime, String> {
        let (events, received) = mpsc::channel::<(u32, bool)>();
        let tracker = Arc::new(Mutex::new(HoldTracker::new(targets)));

        let worker_tracker = Arc::clone(&tracker);
        thread::Builder::new()
            .name("tironian-modifier-hold".into())
            .spawn(move || {
                // Ends when the last sender drops, which `stop` does.
                for (vk, down) in received {
                    let transition = match worker_tracker.lock() {
                        Ok(mut tracker) => tracker.on_key(vk, down, &physically_down),
                        Err(_) => return,
                    };
                    if let Some(transition) = transition {
                        apply(&app, transition);
                    }
                }
            })
            .map_err(|error| format!("start the modifier hold worker: {error}"))?;

        *EVENTS
            .lock()
            .map_err(|_| "modifier hold event lock poisoned".to_string())? = Some(events);

        let (ready, installed) = mpsc::channel::<Result<u32, String>>();
        thread::Builder::new()
            .name("tironian-keyboard-hook".into())
            .spawn(move || {
                // SAFETY: the hook procedure only reads the struct Windows hands
                // it, and the message loop below keeps this thread alive for as
                // long as the hook is installed.
                let module = unsafe { GetModuleHandleW(None) }
                    .ok()
                    .map(|module| HINSTANCE(module.0));
                let hook = match unsafe {
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0)
                } {
                    Ok(hook) => hook,
                    Err(error) => {
                        let _ = ready.send(Err(format!("install the keyboard hook: {error}")));
                        return;
                    }
                };
                let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));
                let mut message = MSG::default();
                // A low-level hook runs on this thread's message loop; WM_QUIT
                // from `stop` ends it.
                while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {}
                if let Err(error) = unsafe { UnhookWindowsHookEx(hook) } {
                    log::warn!("remove the keyboard hook: {error}");
                }
            })
            .map_err(|error| format!("start the keyboard hook thread: {error}"))?;

        let hook_thread = match installed.recv() {
            Ok(Ok(thread_id)) => thread_id,
            Ok(Err(error)) => {
                release_events();
                return Err(error);
            }
            Err(_) => {
                release_events();
                return Err("the keyboard hook thread exited during install".into());
            }
        };
        Ok(Runtime {
            hook_thread,
            tracker,
        })
    }

    fn stop(runtime: &Runtime) {
        if let Err(error) =
            unsafe { PostThreadMessageW(runtime.hook_thread, WM_QUIT, WPARAM(0), LPARAM(0)) }
        {
            log::warn!("stop the keyboard hook thread: {error}");
        }
        release_events();
    }

    fn release_events() {
        if let Ok(mut events) = EVENTS.lock() {
            *events = None;
        }
    }

    fn apply(app: &AppHandle, transition: Transition) {
        match transition {
            Transition::Pressed {
                command_id,
                masks_start_menu,
            } => {
                if masks_start_menu {
                    mask_start_menu();
                }
                emit_shortcut_trigger(app, command_id, GlobalShortcutState::Pressed);
            }
            Transition::Released { command_id } => {
                emit_shortcut_trigger(app, command_id, GlobalShortcutState::Released);
            }
        }
    }

    fn physically_down(vk: u32) -> bool {
        // The high bit is set while the key is down.
        let state = unsafe { GetAsyncKeyState(vk as i32) };
        state < 0
    }

    fn mask_start_menu() {
        let tap = |flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_START_MENU_MASK),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [tap(KEYBD_EVENT_FLAGS(0)), tap(KEYEVENTF_KEYUP)];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            log::warn!("mask the Start menu: SendInput sent {sent} of 2 events");
        }
    }

    /// Runs on the hook thread for every key event on the desktop. It forwards
    /// physical events and returns at once: a hook that stalls is removed by
    /// Windows without notice.
    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // SAFETY: for HC_ACTION, lparam points at a KBDLLHOOKSTRUCT.
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let down = match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
                WM_KEYUP | WM_SYSKEYUP => Some(false),
                _ => None,
            };
            // Injected events are not the person's hands: this app's own mask
            // tap, or a remapper replaying keys.
            if let (Some(down), false) = (down, info.flags.contains(LLKHF_INJECTED)) {
                if let Ok(events) = EVENTS.lock() {
                    if let Some(events) = events.as_ref() {
                        let _ = events.send((info.vkCode, down));
                    }
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CTRL_WIN: u8 = CONTROL | SUPER;

    fn tracker() -> HoldTracker {
        HoldTracker::new(vec![(CTRL_WIN, "pushToTalk".into())])
    }

    fn all_down(_: u32) -> bool {
        true
    }

    fn pressed() -> Option<Transition> {
        Some(Transition::Pressed {
            command_id: "pushToTalk".into(),
            masks_start_menu: true,
        })
    }

    fn released() -> Option<Transition> {
        Some(Transition::Released {
            command_id: "pushToTalk".into(),
        })
    }

    #[test]
    fn ctrl_then_win_presses_and_releasing_either_releases() {
        let mut hold = tracker();
        assert_eq!(hold.on_key(VK_LCONTROL, true, &all_down), None);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
        assert_eq!(hold.on_key(VK_LWIN, false, &all_down), released());
        assert_eq!(hold.on_key(VK_LCONTROL, false, &all_down), None);

        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), None);
        assert_eq!(hold.on_key(VK_RCONTROL, true, &all_down), pressed());
        assert_eq!(hold.on_key(VK_RCONTROL, false, &all_down), released());
    }

    #[test]
    fn auto_repeat_does_not_press_again() {
        let mut hold = tracker();
        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), None);
        assert_eq!(hold.on_key(VK_LCONTROL, true, &all_down), None);
    }

    #[test]
    fn a_third_key_releases_and_nothing_rearms_until_all_modifiers_are_up() {
        let mut hold = tracker();
        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
        // Ctrl+Win+D: the desktop gesture belongs to Windows.
        assert_eq!(hold.on_key(0x44, true, &all_down), released());
        assert_eq!(hold.on_key(0x44, false, &all_down), None);
        assert_eq!(hold.on_key(VK_LWIN, false, &all_down), None);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), None);
        hold.on_key(VK_LWIN, false, &all_down);
        hold.on_key(VK_LCONTROL, false, &all_down);

        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
    }

    #[test]
    fn a_key_before_the_hold_completes_spends_it() {
        let mut hold = tracker();
        hold.on_key(VK_LCONTROL, true, &all_down);
        hold.on_key(0x43, true, &all_down); // Ctrl+C
        hold.on_key(0x43, false, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), None);
    }

    #[test]
    fn an_extra_modifier_releases() {
        let mut hold = tracker();
        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
        assert_eq!(hold.on_key(VK_LSHIFT, true, &all_down), released());
        assert_eq!(hold.on_key(VK_LSHIFT, false, &all_down), None);
    }

    #[test]
    fn a_superset_of_modifiers_never_presses() {
        let mut hold = tracker();
        hold.on_key(VK_LSHIFT, true, &all_down);
        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), None);
    }

    #[test]
    fn a_modifier_whose_release_was_missed_is_forgotten() {
        let mut hold = tracker();
        // Win+L locks the desktop; the secure desktop takes the Win key-up.
        hold.on_key(VK_LWIN, true, &all_down);
        hold.on_key(0x4C, true, &all_down);
        let only_ctrl = |vk: u32| vk == VK_LCONTROL;
        assert_eq!(hold.on_key(VK_LCONTROL, true, &only_ctrl), None);
        assert_eq!(hold.held(), CONTROL);
        // The stale Win no longer spends the next real hold.
        assert_eq!(hold.on_key(VK_LWIN, true, &all_down), pressed());
    }

    #[test]
    fn a_hold_without_win_does_not_mask_start() {
        let mut hold = HoldTracker::new(vec![(CONTROL | ALT, "pushToTalk".into())]);
        hold.on_key(VK_LCONTROL, true, &all_down);
        assert_eq!(
            hold.on_key(VK_LMENU, true, &all_down),
            Some(Transition::Pressed {
                command_id: "pushToTalk".into(),
                masks_start_menu: false,
            })
        );
    }

    #[test]
    fn unregistering_mid_hold_releases() {
        let mut hold = tracker();
        hold.on_key(VK_LCONTROL, true, &all_down);
        hold.on_key(VK_LWIN, true, &all_down);
        assert_eq!(hold.set_targets(Vec::new()), released());
        assert_eq!(hold.on_key(VK_LWIN, false, &all_down), None);
    }

    #[test]
    fn a_hold_needs_two_modifiers() {
        let hold = |modifiers: Vec<HoldModifier>| ModifierHoldRegistration {
            command_id: "pushToTalk".into(),
            modifiers,
        };
        assert!(mask_of(&hold(vec![HoldModifier::Control])).is_err());
        assert!(mask_of(&hold(vec![HoldModifier::Control, HoldModifier::Control])).is_err());
        assert_eq!(
            mask_of(&hold(vec![HoldModifier::Control, HoldModifier::Super])),
            Ok(CTRL_WIN)
        );
    }
}
