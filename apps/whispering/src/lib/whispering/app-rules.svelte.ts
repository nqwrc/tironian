/**
 * Per-application dictation rules, read straight out of the document.
 *
 * The snippets accessor's shape: every row is the person's own, identity is
 * the minted row id (ADR-0206), and matching is someone else's pure function
 * (`operations/match-app-rule.ts`).
 */
import type { NonconformingRow } from '@tironian/data';
import type { AppRule, WhisperingData } from '../workspace';

export function createWhisperingAppRules({
	table,
}: {
	table: WhisperingData['tables']['appRules'];
}) {
	let rows = $state.raw<AppRule[]>([]);
	let nonconforming = $state.raw<NonconformingRow[]>([]);

	/**
	 * Adopt rows written before the `trusted` column existed, exactly as
	 * `recipes.svelte.ts` does and for the same reason: a missing field is a
	 * conformance failure, not a defaulted one, so without this every rule
	 * stored by an earlier release would drop out of the settings table the
	 * moment this one opened it. `update` is the documented repair (ADR-0125).
	 *
	 * They adopt as trusted, which is what they are: settings bundles have never
	 * shipped, so a stored rule is one the person wrote.
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
		// Terminates: the second listing reports the same rows with the column
		// present, so nothing matches the branch above a second time.
		if (adoptPreTrustRows(listed)) listed = table.list();
		rows = listed.rows;
		nonconforming = listed.nonconforming;
	}

	read();
	const stop = table.subscribe(read);

	return {
		[Symbol.dispose]: stop,
		/** Every saved rule, ordered by name for a stable settings table. */
		get all(): AppRule[] {
			return rows.toSorted((left, right) =>
				left.name.localeCompare(right.name),
			);
		},
		get count(): number {
			return rows.length;
		},
		get nonconforming(): NonconformingRow[] {
			return nonconforming;
		},
		/**
		 * Save a rule. An id this store has never seen mints a new row.
		 *
		 * Writes `trusted` exactly as handed in. The caller owns that fact: the
		 * editor carries the person's own answer, and the bundle importer writes
		 * `false`.
		 */
		set({ id, ...fields }: AppRule): void {
			const isRow = rows.some((row) => row.id === id);
			if (isRow) {
				const result = table.update(id, fields);
				if (result.error !== null) throw result.error;
			} else {
				table.create(fields);
			}
			read();
		},
		delete(id: string): void {
			table.delete(id);
			read();
		},
	};
}

export type WhisperingAppRules = ReturnType<typeof createWhisperingAppRules>;
