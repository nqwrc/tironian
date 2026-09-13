import { describe, expect, it } from 'bun:test';
import { type DictationStatsRow, dictationStats } from './dictation-stats';

function row(overrides: Partial<DictationStatsRow> = {}): DictationStatsRow {
	return {
		transcript: 'one two three four five six',
		duration: 3_000,
		recordedAt: '2026-09-13T10:00:00.000Z',
		transcriptionCompletedAt: '2026-09-13T10:00:01.000Z',
		transcriptionStatus: 'completed',
		...overrides,
	} as DictationStatsRow;
}

describe('dictation stats', () => {
	it('has no numbers before a completed recording exists', () => {
		expect(dictationStats([])).toEqual({
			wordsPerMinute: null,
			medianWaitMs: null,
		});
		expect(
			dictationStats([
				row({ transcriptionStatus: 'pending' }),
				row({ transcriptionStatus: 'failed' }),
				row({ transcript: '   ' }),
			]),
		).toEqual({ wordsPerMinute: null, medianWaitMs: null });
	});

	it('divides total words by total minutes, so a short clip cannot swing it', () => {
		// 6 words in 3 s and 60 words in 57 s: 66 words in one minute.
		const stats = dictationStats([
			row(),
			row({ transcript: 'word '.repeat(60), duration: 57_000 }),
		]);
		expect(stats.wordsPerMinute).toBe(66);
	});

	it('leaves a recording with no duration out of the speed but not the wait', () => {
		const stats = dictationStats([row({ duration: null })]);
		expect(stats.wordsPerMinute).toBeNull();
		expect(stats.medianWaitMs).toBe(1_000);
	});

	it('takes the median wait, so one cold model load does not carry it', () => {
		const at = (ms: number) =>
			new Date(Date.parse('2026-09-13T10:00:00.000Z') + ms).toISOString();
		const stats = dictationStats([
			row({ transcriptionCompletedAt: at(500) }),
			row({ transcriptionCompletedAt: at(600) }),
			row({ transcriptionCompletedAt: at(4_000) }),
		]);
		expect(stats.medianWaitMs).toBe(600);
	});

	it('skips a wait that ends before it starts', () => {
		const stats = dictationStats([
			row({ transcriptionCompletedAt: '2026-09-13T09:59:59.000Z' }),
		]);
		expect(stats.medianWaitMs).toBeNull();
	});

	it('reads only the newest completed recordings', () => {
		const recent = Array.from({ length: 2 }, () => row());
		const old = row({ transcript: 'word '.repeat(600), duration: 60_000 });
		expect(dictationStats([...recent, old], 2).wordsPerMinute).toBe(120);
	});
});
