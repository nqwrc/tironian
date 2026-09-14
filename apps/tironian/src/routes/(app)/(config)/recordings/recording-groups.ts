/**
 * The shapes the recordings list (Vivavoce 4c) needs from a flat, newest-first
 * list of rows: day groups, the total time dictated, and the text search. Pure,
 * so the grouping rules are tested without a component.
 */

type GroupedRow = {
	recordedAt: string;
	duration: number | null;
	title: string;
	transcript: string;
	polishedTranscript: string | null;
};

export type DayGroup<T> = {
	/** Local calendar day, `YYYY-MM-DD`: stable across renders. */
	key: string;
	/** Today and yesterday get their own words; other days print their date. */
	relative: 'today' | 'yesterday' | null;
	date: Date;
	recordings: T[];
};

function localDayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Group rows by the local day they were recorded, keeping the input order
 * inside each group and between groups (the list arrives newest first).
 */
export function groupByDay<T extends Pick<GroupedRow, 'recordedAt'>>(
	rows: readonly T[],
	now: Date,
): DayGroup<T>[] {
	const today = localDayKey(now);
	const yesterdayDate = new Date(now);
	yesterdayDate.setDate(now.getDate() - 1);
	const yesterday = localDayKey(yesterdayDate);

	const groups: DayGroup<T>[] = [];
	const byKey = new Map<string, DayGroup<T>>();
	for (const row of rows) {
		const date = new Date(row.recordedAt);
		const key = localDayKey(date);
		let group = byKey.get(key);
		if (!group) {
			group = {
				key,
				relative:
					key === today ? 'today' : key === yesterday ? 'yesterday' : null,
				date,
				recordings: [],
			};
			byKey.set(key, group);
			groups.push(group);
		}
		group.recordings.push(row);
	}
	return groups;
}

/** Sum of known durations; a row without one adds nothing. */
export function totalDurationMs(
	rows: readonly Pick<GroupedRow, 'duration'>[],
): number {
	return rows.reduce((sum, row) => sum + (row.duration ?? 0), 0);
}

/** `2h 12m`, `12m`, or `45s`: the header's time dictated. */
export function formatDictated(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes === 0) return `${Math.round(ms / 1000)}s`;
	const hours = Math.floor(minutes / 60);
	return hours === 0 ? `${minutes}m` : `${hours}h ${minutes % 60}m`;
}

/** `0:41`, `12:05`: a row's duration. */
export function formatClock(ms: number): string {
	const total = Math.round(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Case-insensitive match on the title, the delivered text and the raw text. */
export function matchesQuery(
	row: Pick<GroupedRow, 'title' | 'transcript' | 'polishedTranscript'>,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [row.title, row.polishedTranscript ?? '', row.transcript].some(
		(text) => text.toLowerCase().includes(needle),
	);
}
