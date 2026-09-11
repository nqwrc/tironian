//! The recording overlay: a hidden, non-activating window that shows
//! Tironian's recording status without ever stealing focus from whatever
//! app the user is dictating into.
//!
//! One platform module is compiled per target; each owns its own construction
//! (there is no shared window-building API to factor out, since macOS uses an
//! `NSPanel` and Windows restyles a plain `WebviewWindow` after the fact) but
//! both register under the same `WINDOW_LABEL`, sized to the same fixed pill
//! footprint, so the frontend's `getByLabel`-then-create window manager works
//! identically everywhere it runs.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

// Must stay in sync with `RECORDING_OVERLAY_WINDOW_LABEL` and `OVERLAY_WIDTH`
// / `OVERLAY_HEIGHT` in Tironian's `recording-overlay/window-manager.tauri.ts`.
pub const WINDOW_LABEL: &str = "recording-overlay";
const OVERLAY_WIDTH: f64 = 300.0;
const OVERLAY_HEIGHT: f64 = 72.0;

/// Create the recording overlay window, hidden. The frontend repositions and
/// shows it once recording starts, so the initial position here is unused.
pub fn create_recording_overlay(
    app: &tauri::AppHandle,
    url: tauri::Url,
    initialization_script: String,
    port: u16,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let result = macos::create_recording_overlay(app, url, initialization_script, port);
    #[cfg(target_os = "windows")]
    let result = windows::create_recording_overlay(app, url, initialization_script, port);

    result
}
