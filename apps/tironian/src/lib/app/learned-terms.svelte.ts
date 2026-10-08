import { InstantString } from '@tironian/field';
import type { KnownTerms } from '../operations/learn-corrections/rules';
import { hashFold } from '../operations/learn-corrections/term-hash';
import { foldTerm } from '../operations/learn-corrections/words';
import type { LearnedTerm, TironianData } from '../workspace';

export function createTironianLearnedTerms({
	table,
	forgotten,
}: {
	table: TironianData['tables']['learnedTerms'];
	forgotten: TironianData['tables']['forgottenTerms'];
}) {
	let rows = $state.raw<LearnedTerm[]>([]);
	let forgottenHashes = $state.raw<ReadonlySet<string>>(new Set());
	function read(): void {
		rows = table.list().rows;
	}
	function readForgotten(): void {
		forgottenHashes = new Set(forgotten.list().rows.map((row) => row.hash));
	}
	read();
	readForgotten();
	const stopRows = table.subscribe(read);
	const stopForgotten = forgotten.subscribe(readForgotten);

	const newestFirst = (status: LearnedTerm['status']) =>
		rows
			.filter((row) => row.status === status)
			.toSorted(
				(l, r) =>
					new Date(r.learnedAt).getTime() - new Date(l.learnedAt).getTime(),
			);

	return {
		[Symbol.dispose]() {
			stopRows();
			stopForgotten();
		},
		get active(): LearnedTerm[] {
			return newestFirst('active');
		},
		get pending(): LearnedTerm[] {
			return newestFirst('pending');
		},
		get activeTerms(): string[] {
			return newestFirst('active').map((row) => row.term);
		},
		get rowCount(): number {
			return rows.length;
		},
		/** What the learner checks a candidate against. `manual` is the Dictionary kv value. */
		known(manual: readonly string[] | null): KnownTerms {
			const active = rows
				.filter((row) => row.status === 'active')
				.map((row) => row.term);
			const inUse = new Set([...(manual ?? []), ...active].map(foldTerm));
			const pending = new Map(
				rows
					.filter((row) => row.status === 'pending')
					.map((row) => [foldTerm(row.term), row.id]),
			);
			const hashes = forgottenHashes;
			return {
				inUse: (fold) => inUse.has(fold),
				pendingId: (fold) => pending.get(fold) ?? null,
				forgotten: (hash) => hashes.has(hash),
				rowCount: rows.length,
			};
		},
		/** A new term: pending until the person accepts it or a later dictation repeats it. */
		create(term: string): string {
			const row = table.create({
				term,
				status: 'pending',
				learnedAt: InstantString.now(),
			});
			read();
			return row.id;
		},
		/** From here on the term goes with the Dictionary to every prompt. */
		activate(id: string): void {
			const result = table.update(id, {
				status: 'active',
				learnedAt: InstantString.now(),
			});
			if (result.error !== null) throw result.error;
			read();
		},
		/** Hash first, then delete: a failure in between leaves the word blocked, not free. */
		async forget(id: string): Promise<void> {
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined) return;
			forgotten.create({ hash: await hashFold(foldTerm(row.term)) });
			table.delete(id);
			read();
			readForgotten();
		},
	};
}

export type TironianLearnedTerms = ReturnType<
	typeof createTironianLearnedTerms
>;
