/** Reserved global-chord policy and the shipped-default contract. */
import { expect, test } from 'bun:test';
import { defaultGlobalBindings } from './default-global-bindings';
import { type BindingLike, bindingsEqual } from './key-binding';
import { validateGlobalBinding } from './reserved-shortcuts';

function shippedChords(isApple: boolean): BindingLike[] {
	return Object.values(defaultGlobalBindings(isApple)).filter(
		(binding) => binding !== null,
	);
}

/**
 * The chords a build ships, one row per platform branch, read from the real
 * table. `defaultGlobalBindings` takes the platform as a boolean and touches
 * nothing else, so both rows are reachable from a bun test on either OS and
 * neither can drift away from what ships. Unbound commands drop out here:
 * `null` is not a chord, and both `findConflict` and `push` skip it.
 */
const SHIPPED_DEFAULTS = {
	apple: shippedChords(true),
	other: shippedChords(false),
};

test('an empty binding is treated as unset and passes', () => {
	expect(validateGlobalBinding({ modifiers: [], keys: [] })).toBeNull();
});

test('shipped defaults pass the policy', () => {
	// The guard on the chords no user ever chose: a default never goes through
	// `findConflict`, so this is the only place a reserved shipped chord is
	// caught before it reaches a release.
	const refused: string[] = [];
	for (const [platform, chords] of Object.entries(SHIPPED_DEFAULTS)) {
		for (const binding of chords) {
			const reason = validateGlobalBinding(binding);
			if (reason)
				refused.push(`${platform} ${JSON.stringify(binding)}: ${reason}`);
		}
	}
	expect(refused).toEqual([]);
});

test('shipped defaults are distinct within a platform', () => {
	// Two commands sharing a chord on one device makes one of them
	// unreachable: an accelerator registers once, so `push` drops the loser and
	// the command ships silently dead. Across platforms is fine, since no device
	// holds both rows, so the check never crosses them.
	const duplicates: string[] = [];
	for (const [platform, chords] of Object.entries(SHIPPED_DEFAULTS)) {
		for (const [index, a] of chords.entries()) {
			for (const b of chords.slice(index + 1)) {
				if (bindingsEqual(a, b)) {
					duplicates.push(`${platform}: ${JSON.stringify(a)}`);
				}
			}
		}
	}
	expect(duplicates).toEqual([]);
});

test('Fn and modifier-only holds are refused', () => {
	expect(validateGlobalBinding({ modifiers: ['fn'], keys: [] })).toContain(
		'Only a chord',
	);
	expect(
		validateGlobalBinding({ modifiers: ['ctrl', 'meta'], keys: [] }),
	).toContain('Only a chord');
});

test('a reserved combo is refused with its label', () => {
	const reason = validateGlobalBinding({ modifiers: ['meta'], keys: ['keyR'] });
	expect(reason).toContain('Reload');
});

test('primary expands to control as well as command', () => {
	// Ctrl+R must be blocked too, not just Cmd+R, from the single `primary` entry.
	expect(
		validateGlobalBinding({ modifiers: ['ctrl'], keys: ['keyR'] }),
	).toContain('Reload');
});

test('literal meta+space (Spotlight) is reserved but meta+shift+space is not', () => {
	expect(
		validateGlobalBinding({ modifiers: ['meta'], keys: ['space'] }),
	).toContain('System search');
	// Adding Shift makes it a different set from the reserved Cmd+Space, so it
	// stays allowed (e.g. a user-bound Cmd+Shift+Space).
	expect(
		validateGlobalBinding({ modifiers: ['meta', 'shift'], keys: ['space'] }),
	).toBeNull();
});

test('a bare key with no modifier is refused', () => {
	const reason = validateGlobalBinding({ modifiers: [], keys: ['space'] });
	expect(reason).toContain('modifier');
});

test('a superset of a reserved chord is allowed (exact-set matching)', () => {
	// Ctrl+Win+Space is not the literal meta+space Spotlight chord.
	expect(
		validateGlobalBinding({ modifiers: ['ctrl', 'meta'], keys: ['space'] }),
	).toBeNull();
});
