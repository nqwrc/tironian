use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as NativeShortcutState};
use tauri_specta::Event;

use crate::keyboard::modifier_hold::{self, ModifierHoldRegistration};
use crate::{request_window, BuiltInApp, DesktopAppHandle};

const TRAY_ID: &str = "tironian-tray";
const DICTATION_WINDOW: &str = "dictation";

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutRegistration {
    pub command_id: String,
    pub accelerator: String,
}

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
pub enum GlobalShortcutState {
    Pressed,
    Released,
}

#[derive(Clone, Debug, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutTriggered {
    pub command_id: String,
    pub state: GlobalShortcutState,
}

#[derive(Default)]
pub struct GlobalShortcutRegistry(Mutex<Vec<GlobalShortcutRegistration>>);

pub fn create_tray(app: &DesktopAppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show-dictation", "Show Tironian")
        .separator()
        .text("quit", "Quit Tironian")
        .build()?;
    let icon = tray_icon(false)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Tironian")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-dictation" => request_window(app, BuiltInApp::Dictation),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn set_tray_recording_state(app: &AppHandle, recording: bool) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match tray_icon(recording).and_then(|icon| tray.set_icon(Some(icon))) {
        Ok(()) => {}
        Err(error) => log::warn!("update Tironian tray recording state: {error}"),
    }
}

/// The tray shows the app mark, never a microphone (docs/brand/tironian.md,
/// "The mark"): idle in `--text`, recording in `--accent`. Both images come from
/// `docs/brand/icon/mark.ps1` and are compiled in, so the bundle ships no copy.
fn tray_icon(recording: bool) -> tauri::Result<Image<'static>> {
    let bytes = if recording {
        include_bytes!("../recorder-state-icons/recording.png").as_slice()
    } else {
        include_bytes!("../recorder-state-icons/idle.png").as_slice()
    };
    Image::from_bytes(bytes)
}

/// Replace every global shortcut at once: the plugin chords, and the
/// modifier-only holds only the Windows hook can see (ADR-0246). Either set
/// failing leaves the previous chords registered.
#[tauri::command]
#[specta::specta]
pub fn replace_global_shortcuts(
    app: AppHandle<Wry>,
    registry: tauri::State<'_, GlobalShortcutRegistry>,
    registrations: Vec<GlobalShortcutRegistration>,
    holds: Vec<ModifierHoldRegistration>,
) -> Result<(), String> {
    let hold_targets = validate_registrations(&registrations, &holds)?;
    let mut current = registry
        .0
        .lock()
        .map_err(|_| "global shortcut registry lock poisoned".to_string())?;
    let previous = current.clone();

    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;
    let replaced = register_all(&app, &registrations)
        .and_then(|()| modifier_hold::replace(&app, hold_targets));
    if let Err(error) = replaced {
        let _ = app.global_shortcut().unregister_all();
        if let Err(rollback_error) = register_all(&app, &previous) {
            log::error!(
                "restore Tironian global shortcuts after failed replacement: {rollback_error}"
            );
        }
        return Err(error);
    }

    *current = registrations;
    Ok(())
}

/// Deliver a trigger edge to the dictation window, from a plugin chord or a
/// modifier hold alike, so the command layer sees one event either way.
pub(crate) fn emit_shortcut_trigger(
    app: &AppHandle,
    command_id: String,
    state: GlobalShortcutState,
) {
    if let Err(error) =
        (GlobalShortcutTriggered { command_id, state }).emit_to(app, DICTATION_WINDOW)
    {
        log::warn!("deliver a global shortcut trigger: {error}");
    }
}

/// Check both sets and resolve each hold to its modifier mask. A command owns
/// at most one global gesture, chord or hold.
fn validate_registrations(
    registrations: &[GlobalShortcutRegistration],
    holds: &[ModifierHoldRegistration],
) -> Result<Vec<(u8, String)>, String> {
    let mut command_ids = HashSet::new();
    let mut accelerators = HashSet::new();
    for registration in registrations {
        if registration.command_id.is_empty() || registration.accelerator.is_empty() {
            return Err("global shortcut command ids and accelerators must not be empty".into());
        }
        if !command_ids.insert(&registration.command_id) {
            return Err(format!(
                "duplicate global shortcut command id: {}",
                registration.command_id
            ));
        }
        if !accelerators.insert(&registration.accelerator) {
            return Err(format!(
                "duplicate global shortcut accelerator: {}",
                registration.accelerator
            ));
        }
    }
    let mut masks = HashSet::new();
    let mut targets = Vec::with_capacity(holds.len());
    for hold in holds {
        if hold.command_id.is_empty() {
            return Err("global shortcut command ids must not be empty".into());
        }
        if !command_ids.insert(&hold.command_id) {
            return Err(format!(
                "duplicate global shortcut command id: {}",
                hold.command_id
            ));
        }
        let mask = modifier_hold::mask_of(hold)?;
        if !masks.insert(mask) {
            return Err(format!("duplicate modifier hold for {}", hold.command_id));
        }
        targets.push((mask, hold.command_id.clone()));
    }
    Ok(targets)
}

fn register_all(
    app: &AppHandle<Wry>,
    registrations: &[GlobalShortcutRegistration],
) -> Result<(), String> {
    for registration in registrations {
        let command_id = registration.command_id.clone();
        app.global_shortcut()
            .on_shortcut(registration.accelerator.as_str(), move |app, _, event| {
                let state = match event.state() {
                    NativeShortcutState::Pressed => GlobalShortcutState::Pressed,
                    NativeShortcutState::Released => GlobalShortcutState::Released,
                };
                emit_shortcut_trigger(app, command_id.clone(), state);
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn is_autostart_enabled(app: AppHandle<Wry>) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_autostart_enabled(app: AppHandle<Wry>, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(command_id: &str, accelerator: &str) -> GlobalShortcutRegistration {
        GlobalShortcutRegistration {
            command_id: command_id.into(),
            accelerator: accelerator.into(),
        }
    }

    #[test]
    fn shortcut_replacement_rejects_duplicate_owners() {
        let duplicate_command = [
            registration("record", "Cmd+R"),
            registration("record", "Cmd+T"),
        ];
        assert!(validate_registrations(&duplicate_command, &[]).is_err());

        let duplicate_accelerator = [
            registration("record", "Cmd+R"),
            registration("cancel", "Cmd+R"),
        ];
        assert!(validate_registrations(&duplicate_accelerator, &[]).is_err());
    }

    #[test]
    fn a_command_owns_one_gesture_across_chords_and_holds() {
        use modifier_hold::HoldModifier::{Control, Super};
        let hold = |command_id: &str| ModifierHoldRegistration {
            command_id: command_id.into(),
            modifiers: vec![Control, Super],
        };

        let targets = validate_registrations(
            &[registration("cancel", "Control+Shift+Period")],
            &[hold("pushToTalk")],
        )
        .expect("a chord and a hold for different commands");
        assert_eq!(targets.len(), 1);

        assert!(validate_registrations(
            &[registration("pushToTalk", "Control+Alt+Space")],
            &[hold("pushToTalk")]
        )
        .is_err());
        assert!(validate_registrations(&[], &[hold("pushToTalk"), hold("toggle")]).is_err());
    }
}
