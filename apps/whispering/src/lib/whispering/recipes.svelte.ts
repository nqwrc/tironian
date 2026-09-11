/**
 * Recipes, read straight out of the document.
 *
 * A user recipe's identity IS its minted row id, and the built-in ones ship in
 * code under a `builtin:` prefix and are not rows at all (`workspace/index.ts`,
 * ADR-0099, ADR-0206). So the `sourceId` column and the two-way id map that
 * used to live here are both gone.
 *
 * This is a `.svelte.ts` module because the state IS reactive state, and runes
 * own that. It previously held four `let`s, a `Set` of listeners, a `notify`
 * fanout and a `subscribe` method, which together reimplemented `$state` by
 * hand; and `pickable` was recomputed inside the read, which is what `$derived`
 * is for. It also held a generation counter, an `isDisposed` flag and a retry
 * loop, all of which arbitrated between asynchronous reads that could land out
 * of order. Reads are synchronous now (ADR-0215), so none of that can happen.
 */
import type { NonconformingRow } from '@tironian/data';
import { BUILTIN_RECIPES } from '../state/builtin-recipes';
import type { Recipe, WhisperingData } from '../workspace';

/** The shipped recipes are read-only, so editing one writes a copy. */
const BUILTIN_PREFIX = 'builtin:';

export function createWhisperingRecipes({
	table,
}: {
	table: WhisperingData['tables']['recipes'];
}) {
	let rows = $state.raw<Recipe[]>([]);
	let nonconforming = $state.raw<NonconformingRow[]>([]);

	/**
	 * Adopt rows written before the `trusted` column existed.
	 *
	 * A missing field is a conformance failure, not a defaulted one
	 * (`packages/data`), so without this every recipe stored by an earlier
	 * release would drop out of the library the moment this one opened it.
	 * `update` is the documented repair for a row the current declaration
	 * cannot fully read (ADR-0125).
	 *
	 * They adopt as trusted, which is what they are: settings bundles have
	 * never shipped, so a stored recipe is one the person typed. Trust is not
	 * granted here for anything else, and a row nonconforming for some other
	 * reason is left exactly as it is.
	 */
	function adoptPreTrustRows(listed: ReturnType<typeof table.list>): boolean {
		let repaired = false;
		for (const row of listed.nonconforming) {
			if ('trusted' in row.raw) continue;
			if (table.update(row.id, { trusted: true }).error !== null) continue;
			repaired = true;
		}
		return repaired;
	}

	function read(): void {
		let listed = table.list();
		// The repair terminates: the second listing reports the same rows with
		// the column present, so nothing matches the branch above a second time.
		if (adoptPreTrustRows(listed)) listed = table.list();
		rows = listed.rows;
		nonconforming = listed.nonconforming;
	}

	read();
	const stop = table.subscribe(read);

	return {
		[Symbol.dispose]: stop,
		/** The shipped recipes and the person's own, in one list for the picker. */
		get pickable(): Recipe[] {
			return [
				...BUILTIN_RECIPES,
				...rows.toSorted((left, right) => left.name.localeCompare(right.name)),
			];
		},
		/**
		 * The person's own recipes, ordered by name for a stable export file.
		 * The built-ins are shipped in code and are deliberately not here:
		 * exporting them would be handing the app its own source data back.
		 */
		get all(): Recipe[] {
			return rows.toSorted((left, right) =>
				left.name.localeCompare(right.name),
			);
		},
		/** How many the person wrote. The built-in ones are not theirs. */
		get count(): number {
			return rows.length;
		},
		get nonconforming(): NonconformingRow[] {
			return nonconforming;
		},
		/**
		 * Save a recipe. A built-in one is copied rather than overwritten.
		 *
		 * Writes `trusted` exactly as handed in, on create and on update alike.
		 * The caller owns that fact: the editor carries the person's own answer
		 * (and a file-sourced recipe is promoted only by the acknowledgement on
		 * that form), and the bundle importer writes `false`.
		 */
		set({ id, ...fields }: Recipe): void {
			// A built-in is not a row, so saving one mints a copy the person owns.
			// So does an id this store has never seen, which is what a recipe
			// carried over from another device looks like before it syncs.
			const isRow =
				!id.startsWith(BUILTIN_PREFIX) && rows.some((row) => row.id === id);
			if (isRow) {
				const result = table.update(id, fields);
				if (result.error !== null) throw result.error;
			} else {
				table.create(fields);
			}
			read();
		},
		delete(id: string): void {
			if (id.startsWith(BUILTIN_PREFIX)) return;
			// Reports only whether a row was there to take; an already-gone recipe
			// is still truthfully deleted.
			table.delete(id);
			read();
		},
	};
}

export type WhisperingRecipes = ReturnType<typeof createWhisperingRecipes>;
