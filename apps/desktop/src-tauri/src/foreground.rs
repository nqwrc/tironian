//! Foreground application identity, focused-field probing, and input reach.
//!
//! This module answers three questions about whatever is in front of the user.
//! One pull-based command carries the first two, asked at two named moments:
//! which application is in front (sampled at recording start, to route per-app
//! behavior) and whether the focused UI element is a secure text field
//! (re-sampled immediately before delivery, to withhold a paste into a
//! password box). The third has no command and no frontend caller: whether
//! injected input can reach the foreground window at all, sampled by
//! `delivery` on Windows in the instant before it posts a paste or a copy.
//!
//! Identity is the smallest stable name per platform: the lowercased
//! executable file name on Windows, the bundle identifier on macOS. Window
//! titles are refused by design: they carry document names, URLs, and email
//! subjects, exactly the data class this capability must keep out of prompts,
//! logs, and synced rows.
//!
//! Identity and focused-field detection are best-effort and fail-open. Every
//! probe failure there (no frontmost app, a SYSTEM-owned, protected, or
//! other-user process, a missing macOS Accessibility grant, a UI Automation
//! refusal) collapses to `None` / `Unknown`, which callers must treat as "no
//! rule matches, no guard fires". An unreadable answer costs at most a routing
//! rule or one layer of defense in depth.
//!
//! Input reach is the one fail-closed answer, and the asymmetry is why.
//! Guessing "reachable" wrongly destroys the transcript: the injected paste is
//! dropped, nothing lands at the cursor, and delivery still reports success.
//! Guessing "unreachable" wrongly costs the user one Ctrl+V and tells them the
//! truth about where their text is. So every refusal on that path answers
//! "cannot reach".
//!
//! Two residues come with that direction, accepted rather than overlooked.
//! Being refused a read of a process is not the same question as being refused
//! input to it, so a same-desktop process running under a second user account,
//! or one whose DACL denies a query, is called unreachable while a paste would
//! in fact land in it: that user gets the clipboard fallback on every dictation
//! into their editor and no explanation of why. And the answer is a sample
//! taken `PRE_PASTE_SETTLE` before the keystroke, so focus moving into an
//! elevated window inside that gap is a case where no refusal is possible at
//! all and the transcript is lost from cursor and clipboard both. Neither is
//! closable from here: the first needs a reach test Windows does not expose,
//! the second needs a probe the injection itself performs.

/// What the focused UI element revealed about itself.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FocusedFieldKind {
    /// The platform affirmatively reported a password/secure field.
    Secure,
    /// The platform affirmatively reported a non-secure element.
    NotSecure,
    /// The platform could not say. Callers treat this as not secure.
    Unknown,
}

/// A snapshot of what is in front of the user right now.
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundContext {
    /// Stable per-platform identity: lowercased exe file name on Windows
    /// ("code.exe"), bundle identifier on macOS ("com.microsoft.VSCode").
    /// `None` when the OS refuses to say (no frontmost app, or a SYSTEM-owned,
    /// protected, or other-user process).
    pub app_id: Option<String>,
    /// Human-readable name for settings helper UI only. Never matched against.
    pub app_name: Option<String>,
    pub focused_field: FocusedFieldKind,
}

impl ForegroundContext {
    fn unknown() -> Self {
        Self {
            app_id: None,
            app_name: None,
            focused_field: FocusedFieldKind::Unknown,
        }
    }
}

/// Reports the foreground application and focused-field kind.
///
/// Never errors: every platform refusal degrades to `None` / `Unknown` so a
/// probe failure can never fail a dictation.
#[tauri::command]
#[specta::specta]
pub async fn get_foreground_context(app: tauri::AppHandle) -> ForegroundContext {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        // Win32 and COM calls block; keep them off the async runtime.
        tauri::async_runtime::spawn_blocking(windows_impl::probe)
            .await
            .unwrap_or_else(|_| ForegroundContext::unknown())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        // The AX probe needs Accessibility trust; without it, only identity
        // (which needs no grant) is reported and the field stays `Unknown`.
        // Bare TCC trust, deliberately not the paste path's tap-liveness
        // capability: the tap only runs while auto-paste is enabled, and the
        // secure-field guard must work in clipboard-only configurations too.
        let ax_trusted = crate::keyboard::is_trusted();
        tauri::async_runtime::spawn_blocking(move || macos_impl::probe(ax_trusted))
            .await
            .unwrap_or_else(|_| ForegroundContext::unknown())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        ForegroundContext::unknown()
    }
}

/// Whether injected input posted right now can reach the foreground window.
///
/// Windows UIPI silently drops injected input aimed at a process above our own
/// integrity level: the injection call reports nothing wrong, so a paste into
/// an elevated editor looks successful and inserts nothing, and a copy out of
/// one hands back whatever was already on the clipboard. This is the pre-check
/// that lets `delivery` tell the truth instead.
///
/// Fail-closed, unlike the rest of this module: every refusal answers `false`,
/// including a process the OS declines to open, which is the over-refusal the
/// module doc names. The one exception that is not a refusal is our own
/// process, which UIPI never blocks from itself.
///
/// One assumption is worth stating: this reduces reach to integrity levels,
/// which is only the whole rule while Tironian's manifest does not request
/// `uiAccess="true"`. A uiAccess process may inject above its own level, and
/// this probe would then refuse targets it can actually reach.
#[cfg(target_os = "windows")]
pub(crate) fn foreground_accepts_synthetic_input() -> bool {
    windows_impl::accepts_synthetic_input()
}

/// UIPI permits injected input only into a process at an equal or lower
/// integrity level. This is the whole rule, expressed without Win32.
#[cfg(any(target_os = "windows", test))]
fn integrity_permits_injection(own: u32, target: u32) -> bool {
    target <= own
}

/// Lowercased file name of an executable path ("C:\\...\\Code.exe" ->
/// "code.exe"), or `None` for a path with no file component.
#[cfg(any(target_os = "windows", test))]
fn app_id_from_image_path(path: &str) -> Option<String> {
    let file_name = path.rsplit(['\\', '/']).next()?;
    if file_name.is_empty() {
        return None;
    }
    Some(file_name.to_lowercase())
}

/// Display name for an executable file name ("code.exe" -> "code").
#[cfg(any(target_os = "windows", test))]
fn app_name_from_app_id(app_id: &str) -> String {
    app_id.strip_suffix(".exe").unwrap_or(app_id).to_string()
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{
        app_id_from_image_path, app_name_from_app_id, integrity_permits_injection,
        FocusedFieldKind, ForegroundContext,
    };
    use std::sync::OnceLock;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
    use windows::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
        PSID, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken,
        QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    /// The integrity level a normal desktop application runs at
    /// (SECURITY_MANDATORY_MEDIUM_RID). Written out rather than pulled from
    /// `Win32_System_SystemServices` so this probe costs one crate feature, not
    /// two.
    const MEDIUM_INTEGRITY: u32 = 0x2000;

    pub fn probe() -> ForegroundContext {
        let window = unsafe { GetForegroundWindow() };
        if window.is_invalid() {
            return ForegroundContext {
                app_id: None,
                app_name: None,
                focused_field: FocusedFieldKind::Unknown,
            };
        }
        let app_id = foreground_app_id(window);
        ForegroundContext {
            app_name: app_id.as_deref().map(app_name_from_app_id),
            app_id,
            focused_field: focused_field_kind(),
        }
    }

    /// Process id owning the given window, or `None` when the window is gone.
    fn window_process_id(window: HWND) -> Option<u32> {
        let mut process_id = 0u32;
        if unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) } == 0
            || process_id == 0
        {
            return None;
        }
        Some(process_id)
    }

    /// A read-only handle to the process. `None` when the OS refuses:
    /// SYSTEM-owned, protected (PPL), and other-user processes do; a same-user
    /// elevated process does not, because a process object's mandatory label is
    /// NO_WRITE_UP and this access mask is a read. So this handle says nothing
    /// about input reach on its own; only the token behind it does.
    fn open_for_limited_query(process_id: u32) -> Option<HANDLE> {
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()
    }

    /// Lowercased exe file name of the process owning the given window, or
    /// `None` when the window is gone or the OS refuses to open the process.
    fn foreground_app_id(window: HWND) -> Option<String> {
        let process = open_for_limited_query(window_process_id(window)?)?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let queried = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        queried.ok()?;
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        app_id_from_image_path(&path)
    }

    /// The token integrity level RID of a process, given a limited-query
    /// handle. `None` when the token itself refuses (a protected process does;
    /// `audiodg` is the local example) or the label is malformed.
    fn integrity_level(process: HANDLE) -> Option<u32> {
        let mut token = HANDLE::default();
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
        let level = token_integrity_level(token);
        let _ = unsafe { CloseHandle(token) };
        level
    }

    /// Reads the integrity-level RID out of an already-open token. Closing the
    /// token belongs to the caller, which is what keeps both entry points here
    /// leak-free on their error paths.
    ///
    /// The label lives at the tail of a variable-length structure, so this is
    /// the standard two-call `GetTokenInformation`: size, allocate, read. The
    /// RID is the last sub-authority of the label's SID.
    fn token_integrity_level(token: HANDLE) -> Option<u32> {
        // The sizing call always fails (there is no buffer to write into), so
        // the length it reports back, not its result, is the answer.
        let mut needed = 0u32;
        let _ = unsafe { GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut needed) };
        if needed == 0 {
            return None;
        }
        // Allocated as `u64`, not `u8`: the label is a structure holding a
        // pointer, and both this code and advapi32 dereference it, so a
        // byte-aligned buffer would hand them a misaligned SID. Rounded up, so
        // the byte length handed to the OS stays `needed`.
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];

        // SAFETY: `buffer` is at least the length the OS asked for, aligned for
        // the widest field the label can contain, and outlives every pointer
        // read out of it below. The SID the label carries points into `buffer`
        // and is owned by it, so it must not be freed here. The sub-authority
        // count is read and checked before it indexes, so the final `count - 1`
        // can neither underflow nor read past the SID.
        unsafe {
            GetTokenInformation(
                token,
                TokenIntegrityLevel,
                Some(buffer.as_mut_ptr().cast()),
                needed,
                &mut needed,
            )
            .ok()?;
            let label = buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
            let sid: PSID = (*label).Label.Sid;
            if sid.0.is_null() {
                return None;
            }
            let count = GetSidSubAuthorityCount(sid);
            if count.is_null() || *count == 0 {
                return None;
            }
            let rid = GetSidSubAuthority(sid, u32::from(*count) - 1);
            if rid.is_null() {
                return None;
            }
            Some(*rid)
        }
    }

    /// This process's own integrity level, computed once. A process's token
    /// integrity level cannot change while it runs, so this is a constant.
    /// Falls back to medium when self-inspection fails, which is the
    /// conservative direction: a lower assumed self level refuses more targets,
    /// never fewer.
    fn own_integrity_level() -> u32 {
        static OWN_INTEGRITY: OnceLock<u32> = OnceLock::new();
        *OWN_INTEGRITY.get_or_init(|| {
            let mut token = HANDLE::default();
            // `GetCurrentProcess` hands back a pseudo-handle, not a real one:
            // it must never be closed. The token it opens must be.
            if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.is_err() {
                return MEDIUM_INTEGRITY;
            }
            let level = token_integrity_level(token);
            let _ = unsafe { CloseHandle(token) };
            level.unwrap_or(MEDIUM_INTEGRITY)
        })
    }

    /// Whether injected input can reach whatever holds focus right now.
    ///
    /// Called straight from the tokio thread, deliberately not through
    /// `spawn_blocking` the way `probe` is. The reason `probe` needs a blocking
    /// thread is the cross-process COM/UI Automation call in
    /// `focused_field_kind`, which can stall for the UIA timeout against a hung
    /// target. `OpenProcess`, `OpenProcessToken`, and `GetTokenInformation` are
    /// local kernel calls that cannot block on another process, so moving this
    /// onto the blocking pool would buy latency and nothing else.
    pub fn accepts_synthetic_input() -> bool {
        let window = unsafe { GetForegroundWindow() };
        if window.is_invalid() {
            // Nothing holds focus, so a paste has nowhere to go.
            return false;
        }
        let Some(process_id) = window_process_id(window) else {
            return false;
        };
        // Our own window: the user dictated into one of Tironian's own text
        // boxes. UIPI never blocks a process from injecting into itself, and
        // answering early keeps this case out of reach of a probe failure
        // below.
        if process_id == unsafe { GetCurrentProcessId() } {
            return true;
        }
        let Some(process) = open_for_limited_query(process_id) else {
            return false;
        };
        let target = integrity_level(process);
        let _ = unsafe { CloseHandle(process) };
        let Some(target) = target else {
            return false;
        };
        integrity_permits_injection(own_integrity_level(), target)
    }

    /// Asks UI Automation whether the focused element is a password field.
    ///
    /// Any refusal along the way (COM, no focused element, an elevated target
    /// UIA cannot cross into) is `Unknown`, never an error: the guard is
    /// defense-in-depth against the common accident, not a security boundary.
    fn focused_field_kind() -> FocusedFieldKind {
        // Per-call COM init on this blocking-pool thread; S_FALSE (already
        // initialized) also counts as success and still needs the matching
        // CoUninitialize.
        let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if com.is_err() {
            return FocusedFieldKind::Unknown;
        }
        let kind = (|| {
            let automation: IUIAutomation =
                unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok()?;
            let element = unsafe { automation.GetFocusedElement() }.ok()?;
            let is_password = unsafe { element.CurrentIsPassword() }.ok()?;
            Some(if is_password.as_bool() {
                FocusedFieldKind::Secure
            } else {
                FocusedFieldKind::NotSecure
            })
        })()
        .unwrap_or(FocusedFieldKind::Unknown);
        unsafe { CoUninitialize() };
        kind
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{FocusedFieldKind, ForegroundContext};

    pub fn probe(ax_trusted: bool) -> ForegroundContext {
        let (app_id, app_name) = frontmost_application();
        ForegroundContext {
            app_id,
            app_name,
            focused_field: if ax_trusted {
                focused_field_kind()
            } else {
                FocusedFieldKind::Unknown
            },
        }
    }

    /// Bundle identifier and localized name of the frontmost application.
    /// Needs no Accessibility grant.
    fn frontmost_application() -> (Option<String>, Option<String>) {
        use objc2_app_kit::NSWorkspace;

        let workspace = unsafe { NSWorkspace::sharedWorkspace() };
        let Some(application) = (unsafe { workspace.frontmostApplication() }) else {
            return (None, None);
        };
        let app_id = unsafe { application.bundleIdentifier() }.map(|id| id.to_string());
        let app_name = unsafe { application.localizedName() }.map(|name| name.to_string());
        (app_id, app_name)
    }

    /// Asks the Accessibility API whether the system-wide focused element is a
    /// secure text field. Only called when the process holds the grant; every
    /// AX refusal is `Unknown`.
    ///
    /// The question is the element's subrole, not its role. A secure field is
    /// an `AXTextField` carrying the subrole `AXSecureTextField`, and there is
    /// no `AXSecureTextField` role: `accessibility-sys` exports
    /// `kAXSecureTextFieldSubrole` and no role counterpart. Comparing a role
    /// against that value can only ever be false, so the guard in
    /// `secure-field-guard.ts`, which withholds delivery on `Secure` alone,
    /// would be enabled and inert on macOS.
    fn focused_field_kind() -> FocusedFieldKind {
        use accessibility_sys::{
            kAXErrorAttributeUnsupported, kAXErrorNoValue, kAXErrorSuccess,
            kAXFocusedUIElementAttribute, kAXSecureTextFieldSubrole, kAXSubroleAttribute,
            AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide,
        };
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;
        use core_foundation_sys::base::{CFRelease, CFTypeRef};

        // SAFETY: system-wide element and attribute copies follow the CF
        // create rule; every non-null ref taken here is released before
        // return. The attribute name constants are static strings.
        unsafe {
            let system_wide = AXUIElementCreateSystemWide();
            if system_wide.is_null() {
                return FocusedFieldKind::Unknown;
            }

            let focused_attribute = CFString::new(kAXFocusedUIElementAttribute);
            let mut focused: CFTypeRef = std::ptr::null();
            let copied = AXUIElementCopyAttributeValue(
                system_wide,
                focused_attribute.as_concrete_TypeRef(),
                &mut focused,
            );
            CFRelease(system_wide as CFTypeRef);
            if copied != kAXErrorSuccess || focused.is_null() {
                return FocusedFieldKind::Unknown;
            }

            let subrole_attribute = CFString::new(kAXSubroleAttribute);
            let mut subrole: CFTypeRef = std::ptr::null();
            let copied = AXUIElementCopyAttributeValue(
                focused as accessibility_sys::AXUIElementRef,
                subrole_attribute.as_concrete_TypeRef(),
                &mut subrole,
            );
            CFRelease(focused);

            // Unlike a role, which every element has, a subrole is the
            // exception: the API reports its absence as
            // `kAXErrorAttributeUnsupported` or `kAXErrorNoValue`. That is an
            // answer, not a refusal, and the answer is that this is not a
            // secure field. Folding it into `Unknown` with the genuine
            // failures would leave the probe reporting `Unknown` for nearly
            // every element it ever sees, which is how the role/subrole
            // mix-up above stayed invisible.
            if copied == kAXErrorAttributeUnsupported || copied == kAXErrorNoValue {
                return FocusedFieldKind::NotSecure;
            }
            if copied != kAXErrorSuccess || subrole.is_null() {
                return FocusedFieldKind::Unknown;
            }

            let subrole_name = CFString::wrap_under_create_rule(subrole as _).to_string();
            if subrole_name == kAXSecureTextFieldSubrole {
                FocusedFieldKind::Secure
            } else {
                FocusedFieldKind::NotSecure
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{app_id_from_image_path, app_name_from_app_id, integrity_permits_injection};

    #[test]
    fn app_id_is_the_lowercased_file_name() {
        assert_eq!(
            app_id_from_image_path(
                r"C:\Users\nico\AppData\Local\Programs\Microsoft VS Code\Code.exe"
            ),
            Some("code.exe".to_string())
        );
        assert_eq!(
            app_id_from_image_path(r"C:\WINDOWS\system32\notepad.exe"),
            Some("notepad.exe".to_string())
        );
        assert_eq!(
            app_id_from_image_path("/usr/bin/some-tool"),
            Some("some-tool".to_string())
        );
    }

    #[test]
    fn app_id_refuses_pathless_input() {
        assert_eq!(app_id_from_image_path(""), None);
        assert_eq!(app_id_from_image_path(r"C:\ends\with\separator\"), None);
    }

    #[test]
    fn app_name_drops_the_exe_suffix_only() {
        assert_eq!(app_name_from_app_id("code.exe"), "code");
        assert_eq!(app_name_from_app_id("wt.exe"), "wt");
        assert_eq!(app_name_from_app_id("some-tool"), "some-tool");
    }

    // SECURITY_MANDATORY_* RIDs: 0 untrusted, 0x1000 low, 0x2000 medium,
    // 0x3000 high (what a UAC-elevated process runs at).
    #[test]
    fn injection_cannot_reach_up_into_an_elevated_target() {
        assert!(!integrity_permits_injection(0x2000, 0x3000));
    }

    #[test]
    fn an_elevated_tironian_reaches_an_ordinary_app() {
        assert!(integrity_permits_injection(0x3000, 0x2000));
    }

    #[test]
    fn equal_integrity_levels_pass() {
        assert!(integrity_permits_injection(0x2000, 0x2000));
    }

    #[test]
    fn injection_reaches_down_into_sandboxed_targets() {
        assert!(integrity_permits_injection(0x2000, 0x1000));
        assert!(integrity_permits_injection(0x2000, 0));
    }
}
