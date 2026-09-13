# ADR-0246: Ctrl+Win push-to-talk on Windows

- Status: Accepted
- Date: 2026-09-13
- Amends: ADR-0117 on Windows only. That record no longer ships in this
  repository; its rule survives in code comments and tests: global shortcuts
  are `tauri-plugin-global-shortcut` chords, one key plus a modifier, and Fn and
  modifier-only holds are refused.

## Context

The owner dictates by holding Ctrl+Win. Before this decision that worked only
through an AutoHotkey script that caught Ctrl+Win and held Ctrl+Alt+Shift+F12
for the dictation app, because Tironian could not bind Ctrl+Win itself. The
owner asked for it to be native and the default, with no script.

`RegisterHotKey`, which the plugin uses on Windows, takes one virtual key plus
modifiers. It has no modifier-only form, and the plugin detects the release by
polling `GetAsyncKeyState` after the press, so nothing in the chord path can
see a hold of Ctrl and Win alone.

What ADR-0117 refused, as far as the code still says, was input that costs a
permission or a fragile listener: the macOS event tap needs the Accessibility
grant, and the `rdev` listener it replaced died under load. On Windows a
low-level keyboard hook needs no grant. That asymmetry is what reopens the
question here and leaves it closed on macOS and Linux.

## Decision

1. On Windows, push-to-talk may be a modifier-only hold, and Ctrl+Win is its
   shipped default. macOS keeps Ctrl+Shift+Space and Linux Ctrl+Alt+Space.
2. A hold is at least two distinct non-Fn modifiers with no key. One held
   modifier is part of nearly every chord and would start a recording on
   ordinary typing.
3. Only push-to-talk may be a hold. A hold is a press-and-release gesture made
   of keys that also begin ordinary chords, which suits holding to talk and not
   a command that toggles on a press.
4. The host installs a `WH_KEYBOARD_LL` hook only while a hold is registered,
   in `apps/desktop/src-tauri/src/keyboard/modifier_hold.rs`. The hook observes
   and never swallows: every event continues to Windows and the foreground app.
   It keeps which modifiers are down and whether another key was pressed, and
   nothing else. Injected events are ignored.
5. A hold presses when its exact modifier set is down and no other key was
   pressed since the first modifier went down. It releases on a modifier up,
   an extra modifier, or another key, and does not re-arm until every modifier
   is up. So Ctrl+Win+D and Ctrl+Win+Left remain Windows gestures, at the cost
   of a short push-to-talk edge when they begin.
6. When the hold includes Win, the host taps the unassigned virtual key `0xE8`
   at the press, so releasing Win does not open Start.
7. Before a press, every tracked modifier is checked against
   `GetAsyncKeyState`, so a release the hook never saw (the secure desktop takes
   the key-up after Win+L or a UAC prompt) cannot complete or block a hold.
8. Holds travel beside chords in the one `replace_global_shortcuts` call and
   trigger through the same `GlobalShortcutTriggered` event, so the command
   layer and the push-to-talk operation do not change.
9. A binding a device already stored outranks the default. A device that saved
   Ctrl+Alt+Space keeps it until the person records Ctrl+Win in Settings,
   Shortcuts.

## Consequences

- The AutoHotkey script is no longer needed for push-to-talk, and it should
  not run beside this: it catches the same keys and sends a chord of its own.
- A process that watches every key on the desktop is a thing security tools
  notice. The hook runs only while a hold is registered and exports no key
  identity, which is the whole of the mitigation.
- The macOS and Linux refusal stands. Reopening it there means spending the
  Accessibility grant or a compositor-specific listener, which is a new
  decision.
