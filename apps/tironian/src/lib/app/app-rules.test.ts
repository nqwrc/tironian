/**
 * App rules domain: adopting rows written before the `trusted` column existed.
 *
 * The recipes domain's test, for the same failure: a missing field is a
 * conformance failure, not a defaulted one, so the release that adds a column
 * is the release that can empty the settings table. Nothing else in the suite
 * would catch it, because every row a test creates by hand is written by this
 * release and reads fine.
 */
import { expect, test } from 'bun:test';

(globalThis as unknown as { $state: unknown }).$state = Object.assign(
	<TValue>(value: TValue) => value,
	{ raw: <TValue>(value: TValue) => value },
);

const { createTironianAppRules } = await import('./app-rules.svelte.js');

type AppRulesTable = Parameters<typeof createTironianAppRules>[0]['table'];

test('a rule stored before the trusted column survives the release that adds it', () => {
	const stored: Record<string, unknown> = {
		name: 'Terminal',
		matchWindowsExe: 'wt.exe',
		matchMacosBundleId: null,
		polishInstructions: 'No punctuation, all lowercase.',
		recipeId: null,
		enabled: true,
	};
	const updates: Record<string, unknown>[] = [];

	const table = {
		list: () =>
			'trusted' in stored
				? { rows: [{ id: 'row_1', ...stored }], nonconforming: [] }
				: {
						rows: [],
						nonconforming: [
							{
								id: 'row_1',
								raw: { ...stored },
								conforming: { ...stored },
								issues: [{ field: 'trusted', message: 'missing' }],
							},
						],
					},
		update: (rowId: string, fields: Record<string, unknown>) => {
			updates.push(fields);
			if (rowId === 'row_1') Object.assign(stored, fields);
			return { data: undefined, error: null };
		},
		create: () => ({ id: 'row_2' }),
		delete: () => true,
		subscribe: () => () => {},
	} as unknown as AppRulesTable;

	const rules = createTironianAppRules({ table });

	expect(rules.all.map((row) => row.name)).toEqual(['Terminal']);
	expect(rules.nonconforming).toEqual([]);
	// Adopted as trusted: bundle import has never shipped, so a stored rule is
	// one the person wrote. Its directive keeps commanding the pass, as it did
	// before this column existed.
	expect(rules.all[0]?.trusted).toBe(true);
	expect(updates).toEqual([{ trusted: true }]);
});
