/**
 * The two dictation numbers the sidebar shows, read from recordings this
 * device already holds. Nothing is counted on the side: a stat that needed its
 * own bookkeeping would drift from the recordings list it summarises.
 *
 * - Words per minute dictated: words in the raw transcript over minutes of
 *   recorded audio, as a ratio of the sums so one short clip cannot swing it.
 *   The raw transcript, not the polished one, because Polish shortens text and
 *   this measures how fast a person speaks.
 * - Median wait for text: from the row's creation, the moment recording
 *   stopped, to the transcript landing. The median, because a cold model load
 *   can double a single wait and the mean would carry it.
 *
 * Both read the newest {@link STATS_WINDOW} completed recordings, so the numbers
 * follow how the app behaves now rather than months ago.
 */
import type { Recording } from '$lib/app/recording';

export type DictationStatsRow = Pick<
	Recording,
	| 'transcript'
	| 'duration'
	| 'recordedAt'
	| 'transcriptionCompletedAt'
	| 'transcriptionStatus'
>;

export type DictationStats = {
	/** `null` until a completed recording has both words and a duration. */
	wordsPerMinute: number | null;
	/** `null` until a completed recording has a completion instant. */
	medianWaitMs: number | null;
};

/** How many recent completed recordings the stats read. */
export const STATS_WINDOW = 50;

function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Compute the sidebar stats from recordings ordered newest first. */
export function dictationStats(
	newestFirst: readonly DictationStatsRow[],
	window = STATS_WINDOW,
): DictationStats {
	let words = 0;
	let minutes = 0;
	const waits: number[] = [];
	let read = 0;

	for (const row of newestFirst) {
		if (read >= window) break;
		if (row.transcriptionStatus !== 'completed') continue;
		const count = countWords(row.transcript);
		if (count === 0) continue;
		read += 1;

		if (row.duration !== null && row.duration > 0) {
			words += count;
			minutes += row.duration / 60_000;
		}
		const completedAt = row.transcriptionCompletedAt;
		if (typeof completedAt === 'string') {
			const wait = Date.parse(completedAt) - Date.parse(row.recordedAt);
			if (Number.isFinite(wait) && wait >= 0) waits.push(wait);
		}
	}

	return {
		wordsPerMinute: minutes > 0 ? Math.round(words / minutes) : null,
		medianWaitMs: median(waits),
	};
}
