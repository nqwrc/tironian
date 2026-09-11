/**
 * Snippets, read straight out of the document.
 *
 * The recipes accessor's shape without the `builtin:` handling: no snippet
 * ships in code, so every row is the person's own and identity is always the
 * minted row id (ADR-0206).
 */
import type { NonconformingRow } from '@tironian/data';
import type { Snippet, WhisperingData } from '../workspace';

export function createWhisperingSnippets({
	table,
}: {
	table: WhisperingData['tables']['snippets'];
}) {
	let rows = $state.raw<Snippet[]>([]);
	let nonconforming = $state.raw<NonconformingRow[]>([]);

	function read(): void {
		const listed = table.list();
		rows = listed.rows;
		nonconforming = listed.nonconforming;
	}

	read();
	const stop = table.subscribe(read);

	return {
		[Symbol.dispose]: stop,
		/** Every saved snippet, ordered by trigger for a stable settings table. */
		get all(): Snippet[] {
			return rows.toSorted((left, right) =>
				left.trigger.localeCompare(right.trigger),
			);
		},
		get count(): number {
			return rows.length;
		},
		get nonconforming(): NonconformingRow[] {
			return nonconforming;
		},
		/** Save a snippet. An id this store has never seen mints a new row. */
		set({ id, ...fields }: Snippet): void {
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

export type WhisperingSnippets = ReturnType<typeof createWhisperingSnippets>;
