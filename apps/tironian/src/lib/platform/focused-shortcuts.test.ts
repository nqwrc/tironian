/**
 * Focused Shortcut Reset Tests
 *
 * "Reset shortcuts" used to add in-app bindings no install has ever had. Every
 * `shortcut*Keys` default is null and a clean kv read takes the stored object
 * as-is, so a fresh Tironian has no focused shortcuts at all, but the reset
 * button read a separate `DEFAULT_SHORTCUT_KEYS` table and wrote bare Space, C,
 * V, T, R and comma. The settings page's own reset restored the nulls, so the
 * two buttons disagreed about what "defaults" meant.
 *
 * Key behavior: reset restores the settings default and nothing else, for every
 * command. Asserted against a default that is not null for one command, so it
 * pins the rule rather than today's constants: seeding a real in-app shortcut
 * later should not need this test rewritten.
 *
 * `$lib` is a SvelteKit alias with no runtime resolution under `bun test`, so
 * the three runtime imports are supplied here. `key-binding` is handed its real
 * implementation, because `isEmptyBinding` is what turns a pair of nulls into an
 * unbound command and faking it would hollow out the assertion.
 */
import { expect, mock, test } from 'bun:test';
import type { KeyBinding } from '$lib/utils/key-binding';

/**
 * Three real command ids: two that the deleted table covered (one of them the
 * bare-Space case) and `openSettings`, which it also covered, alongside
 * `pushToTalk`, which it never did. `pushToTalk` is the control on the control:
 * it behaved correctly before and must still.
 */
const CATALOG = [
	{ id: 'toggleManualRecording' },
	{ id: 'cancelRecording' },
	{ id: 'openSettings' },
	{ id: 'pushToTalk' },
] as const;

const keyBinding = await import('../utils/key-binding.js');
mock.module('$lib/utils/key-binding', () => keyBinding);
mock.module('$lib/commands', () => ({ commands: CATALOG }));
mock.module('$lib/services/local-shortcut-manager', () => ({
	LocalShortcutManagerLive: {
		register: () => undefined,
		unregister: () => undefined,
	},
}));
mock.module('$lib/report', () => ({ report: { error: () => undefined } }));

const { createFocusedShortcuts } = await import('./focused-shortcuts.js');

/**
 * The settings defaults this test runs against. `toggleManualRecording` carries
 * a real chord on purpose: the rule under test is "reset restores the settings
 * default", and a table of all-nulls could not tell that apart from "reset
 * unbinds everything".
 */
const DEFAULTS: Record<string, readonly string[] | null> = {
	shortcutToggleManualRecordingModifiers: ['ctrl', 'shift'],
	shortcutToggleManualRecordingKeys: ['keyK'],
};

function fakeApp() {
	const stored = new Map<string, readonly string[] | null>();
	const settings = {
		get: (key: string) => stored.get(key) ?? null,
		getDefault: (key: string) => DEFAULTS[key] ?? null,
		set: (key: string, value: readonly string[] | null) => {
			stored.set(key, value);
		},
	};
	return { settings } as unknown as Parameters<
		typeof createFocusedShortcuts
	>[0];
}

const BARE_SPACE: KeyBinding = { modifiers: [], keys: ['space'] };

test('reset restores the settings default for a command that has one', () => {
	const shortcuts = createFocusedShortcuts(fakeApp());
	void shortcuts.set('toggleManualRecording', BARE_SPACE);

	shortcuts.reset();

	expect(shortcuts.current('toggleManualRecording')).toEqual({
		modifiers: ['ctrl', 'shift'],
		keys: ['keyK'],
	});
});

/**
 * The assertion the old table failed. `cancelRecording` and `openSettings` have
 * no settings default, so reset has to leave them unbound; the table gave them
 * bare C and bare comma instead.
 */
test('reset leaves a command with no settings default unbound', () => {
	const shortcuts = createFocusedShortcuts(fakeApp());
	void shortcuts.set('cancelRecording', BARE_SPACE);
	void shortcuts.set('openSettings', BARE_SPACE);

	shortcuts.reset();

	expect(shortcuts.current('cancelRecording')).toBeNull();
	expect(shortcuts.current('openSettings')).toBeNull();
});

test('a command the deleted table never covered still resets to unbound', () => {
	const shortcuts = createFocusedShortcuts(fakeApp());
	void shortcuts.set('pushToTalk', BARE_SPACE);

	shortcuts.reset();

	expect(shortcuts.current('pushToTalk')).toBeNull();
});
