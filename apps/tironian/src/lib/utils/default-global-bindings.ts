/**
 * The global chords Tironian ships with, as a function of the one bit that
 * decides them: whether this device uses Apple modifiers. Pure and DOM-free
 * like its neighbours `key-binding.ts` and `reserved-shortcuts.ts`, so the
 * table a build actually ships is the table `reserved-shortcuts.test.ts` runs
 * against the reserved-chord policy, rather than a hand copy that can drift
 * away from it silently.
 *
 * `state/device-config.svelte.ts` resolves this once against `#platform/os` and
 * exports the result as `DEFAULT_GLOBAL_BINDINGS`; that resolved table is also
 * where the per-command device-config schema defaults come from.
 */

import type { KeyBinding } from './key-binding';

/**
 * The shipped global gestures, not mnemonic app hotkeys. These are plain chords
 * the `tauri-plugin-global-shortcut` backend registers with no Accessibility
 * grant, the only global-shortcut backend on every platform (ADR-0117).
 *
 * ```
 *            hold                toggle             cancel
 *   Apple    Ctrl+Shift+Space    Cmd+Shift+Space    Cmd+.
 *   other    Ctrl+Alt+Space      Ctrl+Shift+Space   Ctrl+Shift+.
 * ```
 *
 * Every binding is distinct within a platform, which is the invariant that
 * matters: Ctrl+Shift+Space is the Apple hold and the non-Apple toggle, and
 * that is not a collision because no device ever holds both rows. The null
 * defaults are exempt by construction, since `findConflict` compares only
 * non-null bindings and `push` skips nulls.
 *
 * Toggle recording is the out-of-the-box gesture: press once to start and again
 * to stop. A chord is the right tool for a toggle; its press effort resists
 * accidental triggers. Push-to-talk is hold to talk, release to stop, and it
 * works globally with no local-shortcut fallback because the plugin's
 * ShortcutState carries both Pressed and Released (`operations/push-to-talk.ts`,
 * `operations/hands-free.ts` for the double-tap hands-free lock on top of it).
 *
 * The hold chord branches per platform for the same reason toggle and cancel
 * do. Ctrl+Option+Space is Apple's own default for "select the next input
 * source" and Ctrl+Space is Apple's default for the previous one, so the whole
 * Control+Space family is already spoken for on macOS, and this app neither
 * detects nor routes around a system chord. macOS therefore trades Option for
 * Shift. The two neighbours a reader reaches for next are taken as well:
 * Cmd+Option+Space is Finder's Spotlight search and Ctrl+Cmd+Space is the
 * Character Viewer. Ctrl+Alt+Space stays the non-Apple default because no
 * Windows or Linux input-source gesture claims it there (Windows uses
 * Win+Space, GNOME Super+Space).
 *
 * What that trade costs: the Apple hold and the Apple toggle differ by one
 * modifier, Control against Command, so catching the wrong one starts a toggle
 * recording that no release will stop, since `toggleManualRecording` listens on
 * Pressed only. Accepted. The non-Apple pair has always been one modifier apart
 * the same way (Alt against Shift), a mis-hit is recoverable by pressing the
 * toggle again, and a hold that shadows a system gesture is the worse trade:
 * that chord never reaches the app at all, so nothing can recover it.
 *
 * The branch lives here and not in `reserved-shortcuts.ts` because the reserved
 * table is platform-blind by construction: its only platform device, the
 * `primary` token, expands to both meta and ctrl on every OS, and the table has
 * to keep passing ctrl+alt+space since that is still the non-Apple default. A
 * macOS-only conflict cannot be expressed there today, so it is avoided in the
 * default instead.
 *
 * Cancel is the platform cancel chord (Cmd + . on macOS, the system cancel
 * gesture since classic Mac OS; Ctrl + Shift + . elsewhere); it carries a
 * modifier so it is safe to register globally. Recipe gestures ship unbound:
 * opt-in only.
 */
export function defaultGlobalBindings(isApple: boolean) {
	const hold: KeyBinding['modifiers'] = isApple
		? ['ctrl', 'shift']
		: ['ctrl', 'alt'];

	const toggle: KeyBinding['modifiers'] = isApple
		? ['meta', 'shift']
		: ['ctrl', 'shift'];

	const cancel: KeyBinding['modifiers'] = isApple
		? ['meta']
		: ['ctrl', 'shift'];

	return {
		pushToTalk: { modifiers: hold, keys: ['space'] },
		toggleManualRecording: { modifiers: toggle, keys: ['space'] },
		cancelRecording: { modifiers: cancel, keys: ['dot'] },
		toggleVadRecording: null,
		openRecipePicker: null,
		runRecipeOnClipboard: null,
		// Focused-reach command (ADR-0052): its reach ceiling clamps any key to the
		// in-app store, so the router never writes this global slot. It stays here
		// only so the system backend's all-commands sync keeps one entry per
		// command; always null.
		openSettings: null,
	} satisfies Record<string, KeyBinding | null>;
}
