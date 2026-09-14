import { describe, expect, it } from 'bun:test';
import {
	formatClock,
	formatDictated,
	groupByDay,
	matchesQuery,
	totalDurationMs,
} from './recording-groups';

const at = (y: number, m: number, d: number, h = 12) =>
	new Date(y, m - 1, d, h).toISOString();

describe('recordings list shapes', () => {
	it('groups by local day, today and yesterday named, order kept', () => {
		const now = new Date(2026, 8, 13, 18);
		const rows = [
			{ id: 'a', recordedAt: at(2026, 9, 13, 14) },
			{ id: 'b', recordedAt: at(2026, 9, 13, 9) },
			{ id: 'c', recordedAt: at(2026, 9, 12, 17) },
			{ id: 'd', recordedAt: at(2026, 9, 1, 10) },
		];
		const groups = groupByDay(rows, now);
		expect(groups.map((g) => g.relative)).toEqual(['today', 'yesterday', null]);
		expect(groups.map((g) => g.recordings.map((r) => r.id))).toEqual([
			['a', 'b'],
			['c'],
			['d'],
		]);
	});

	it('names yesterday across a month boundary', () => {
		const now = new Date(2026, 9, 1, 9);
		const [group] = groupByDay([{ recordedAt: at(2026, 9, 30) }], now);
		expect(group?.relative).toBe('yesterday');
	});

	it('sums known durations and formats them', () => {
		expect(
			totalDurationMs([
				{ duration: 41_000 },
				{ duration: null },
				{ duration: 72_000 },
			]),
		).toBe(113_000);
		expect(formatDictated(45_000)).toBe('45s');
		expect(formatDictated(12 * 60_000)).toBe('12m');
		expect(formatDictated((2 * 60 + 12) * 60_000)).toBe('2h 12m');
		expect(formatClock(41_000)).toBe('0:41');
		expect(formatClock(725_000)).toBe('12:05');
	});

	it('searches title, delivered text and raw text without case', () => {
		const row = {
			title: '',
			transcript: 'ciao marta',
			polishedTranscript: 'Ciao Marta, ti confermo la call',
		};
		expect(matchesQuery(row, 'CONFERMO')).toBe(true);
		expect(matchesQuery(row, 'marta')).toBe(true);
		expect(matchesQuery(row, 'budget')).toBe(false);
		expect(matchesQuery(row, '  ')).toBe(true);
	});
});
