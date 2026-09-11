/**
 * Recipes domain: adopting rows written before the `trusted` column existed.
 *
 * A missing field is a conformance failure, not a defaulted one, so the release
 * that adds a column is the release that can make every stored recipe vanish
 * from the library. That is the one failure here worth a test of its own, and
 * nothing else in the suite would catch it: the column reads fine on rows this
 * release wrote, which is every row a test creates by hand.
 *
 * The domain IS reactive state, so the runes are shimmed to their non-reactive
 * meaning, the pattern `app.test.ts` uses. The table is a fake rather than a
 * store because the question is what the domain does with a nonconforming
 * listing, and a real store would have to be talked into producing one.
 */
import { expect, test } from 'bun:test';

(globalThis as unknown as { $state: unknown }).$state = Object.assign(
	<TValue>(value: TValue) => value,
	{ raw: <TValue>(value: TValue) => value },
);

const { createTironianRecipes } = await import('./recipes.svelte.js');

type RecipesTable = Parameters<typeof createTironianRecipes>[0]['table'];

/**
 * A table holding one row stored by an earlier release: no `trusted` key, so
 * this release reads it as nonconforming until it is repaired.
 */
function tableWithPreTrustRow() {
	const stored: Record<string, unknown> = {
		name: 'Standup',
		instructions: 'Turn this into three bullets.',
		icon: null,
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
								issues: [],
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
	} as unknown as RecipesTable;

	return { table, updates };
}

test('a recipe stored before the trusted column survives the release that adds it', () => {
	const { table, updates } = tableWithPreTrustRow();

	const recipes = createTironianRecipes({ table });

	// The row is in the library rather than in the nonconforming pile.
	expect(recipes.all.map((row) => row.name)).toEqual(['Standup']);
	expect(recipes.nonconforming).toEqual([]);
	// It adopts as trusted: bundle import has never shipped, so a stored recipe
	// is one the person typed.
	expect(recipes.all[0]?.trusted).toBe(true);
	// One repair, and the second listing has nothing left to match.
	expect(updates).toEqual([{ trusted: true }]);
});

test('a row nonconforming for some other reason is left exactly as it is', () => {
	const updates: Record<string, unknown>[] = [];
	const table = {
		list: () => ({
			rows: [],
			nonconforming: [
				{
					id: 'row_1',
					// The column is present, so this row is broken some other way and
					// stamping it would be inventing a fact.
					raw: { name: 42, instructions: 'x', icon: null, trusted: false },
					conforming: { instructions: 'x', icon: null, trusted: false },
					issues: [{ field: 'name', message: 'expected a string' }],
				},
			],
		}),
		update: (_rowId: string, fields: Record<string, unknown>) => {
			updates.push(fields);
			return { data: undefined, error: null };
		},
		create: () => ({ id: 'row_2' }),
		delete: () => true,
		subscribe: () => () => {},
	} as unknown as RecipesTable;

	const recipes = createTironianRecipes({ table });

	expect(updates).toEqual([]);
	expect(recipes.nonconforming.map((row) => row.id)).toEqual(['row_1']);
});
