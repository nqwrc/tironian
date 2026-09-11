//! The recording overlay as a plain, restyled `WebviewWindow`.
//!
//! Windows has no panel type: a `WebviewWindow` built with `focused(false)`
//! only skips the *initial* activation Tauri would otherwise do at creation.
//! It still activates the app the moment the user clicks it, which would
//! yank focus away from whatever app they are dictating into and send the
//! auto-paste keystroke at the overlay instead of the target editor. The fix
//! is the same one Chromium and Wispr Flow use on Windows: add
//! `WS_EX_NOACTIVATE` to the window's extended style right after creation, so
//! the window never becomes the foreground window no matter what is clicked
//! on it. `WS_EX_TOOLWINDOW` is added alongside it to keep the overlay out of
//! Alt+Tab and the taskbar (`skip_taskbar(true)` only removes the taskbar
//! button, not the Alt+Tab entry).
//!
//! The window is created hidden at startup and registered under the same
//! `recording-overlay` label the JS window manager looks up, so the frontend
//! drives show/hide/position/status exactly as it would if it had created the
//! window itself (the manager already prefers an existing window via
//! `getByLabel` before creating one).

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::{OVERLAY_HEIGHT, OVERLAY_WIDTH, WINDOW_LABEL};

/// Create the recording overlay window, hidden. The frontend repositions and
/// shows it once recording starts, so the initial position here is unused.
pub fn create_recording_overlay(
    app: &AppHandle,
    url: tauri::Url,
    initialization_script: String,
    port: u16,
) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Recording")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .focused(false)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .shadow(false)
        .visible(false)
        .initialization_script(initialization_script)
        .on_navigation(move |url| crate::is_allowed_navigation(url, port))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;

    set_non_activating_style(&window)?;
    Ok(())
}

/// Add `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` to whatever extended style Tauri
/// already applied (layered and topmost, from `transparent(true)` and
/// `always_on_top(true)`) instead of replacing it outright.
fn set_non_activating_style(window: &WebviewWindow) -> tauri::Result<()> {
    // `window.hwnd()` returns the `HWND` from the `windows` version Tauri
    // itself depends on, which is not necessarily the same crate instance as
    // ours; rebuild one from the same `*mut c_void` pointer rather than
    // assuming the types unify.
    let raw = window.hwnd()?;
    let hwnd = HWND(raw.0);

    // SAFETY: `hwnd` names the window this function just built and is still
    // alive; both calls only read and write the window's extended style bits
    // and have no other side effects.
    unsafe {
        let existing_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let non_activating_style =
            existing_style | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, non_activating_style);
    }
    Ok(())
}
