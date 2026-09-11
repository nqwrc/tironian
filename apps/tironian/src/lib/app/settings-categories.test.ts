import { expect, test } from 'bun:test';
import { tironianDefinition } from '../workspace';
import {
	PREFERENCE_CATEGORIES,
	PREFERENCE_CATEGORY_KEYS,
	PREFERENCE_CATEGORY_LABELS,
} from './settings-categories';

test('every settings key belongs to exactly one export category', () => {
	const allKeys = Object.keys(tironianDefinition.kv);
	const categorized: string[] = Object.values(PREFERENCE_CATEGORY_KEYS).flat();

	const counts = new Map<string, number>();
	for (const key of categorized) counts.set(key, (counts.get(key) ?? 0) + 1);

	const uncategorized = allKeys.filter((key) => !counts.has(key));
	const duplicated = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([key]) => key);

	expect(uncategorized).toEqual([]);
	expect(duplicated).toEqual([]);
});

test('no category lists a key that does not exist', () => {
	const allKeys = new Set(Object.keys(tironianDefinition.kv));
	const unknown: string[] = Object.values(PREFERENCE_CATEGORY_KEYS)
		.flat()
		.filter((key) => !allKeys.has(key));
	expect(unknown).toEqual([]);
});

test('every category has a label and at least one key', () => {
	for (const category of PREFERENCE_CATEGORIES) {
		expect(PREFERENCE_CATEGORY_LABELS[category]).toBeTruthy();
		expect(PREFERENCE_CATEGORY_KEYS[category].length).toBeGreaterThan(0);
	}
});
