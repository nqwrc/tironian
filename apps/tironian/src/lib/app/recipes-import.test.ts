import { expect, test } from 'bun:test';
import { expectErr, expectOk } from 'wellcrafted/testing';
import {
	dedupeRecipesAgainstExisting,
	parseRecipesImport,
} from './recipes-import';

test('parses a well-formed export', () => {
	const result = parseRecipesImport(
		JSON.stringify([
			{ name: 'Email', instructions: 'Turn this into an email.', icon: null },
		]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([
		{ name: 'Email', instructions: 'Turn this into an email.', icon: null },
	]);
	expect(rejected).toBe(0);
});

test('rejects text that is not JSON', () => {
	expect(expectErr(parseRecipesImport('not json'))).toEqual({
		type: 'NotJson',
	});
});

test('rejects JSON that is not an array', () => {
	expect(expectErr(parseRecipesImport('{"name":"x"}'))).toEqual({
		type: 'NotAnArray',
	});
});

test('drops entries missing a name or instructions, keeps the rest', () => {
	const result = parseRecipesImport(
		JSON.stringify([
			{ name: 'ok', instructions: 'fine', icon: null },
			{ name: '', instructions: 'no name', icon: null },
			{ name: 'no instructions', instructions: '', icon: null },
			{ name: 'wrong icon type', instructions: 'fine', icon: 42 },
			'not an object',
		]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([{ name: 'ok', instructions: 'fine', icon: null }]);
	expect(rejected).toBe(4);
});

test('drops an entry whose instructions exceed the length cap', () => {
	const result = parseRecipesImport(
		JSON.stringify([
			{ name: 'too long', instructions: 'x'.repeat(10_001), icon: null },
		]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([]);
	expect(rejected).toBe(1);
});

test('treats a missing icon as no icon rather than a rejection', () => {
	const result = parseRecipesImport(
		JSON.stringify([{ name: 'Email', instructions: 'Make it an email.' }]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([
		{ name: 'Email', instructions: 'Make it an email.', icon: null },
	]);
	expect(rejected).toBe(0);
});

test('dedupeRecipesAgainstExisting skips a name already in the table, case-insensitively', () => {
	const { toCreate, skippedDuplicate } = dedupeRecipesAgainstExisting(
		[{ name: 'Email', instructions: 'x', icon: null }],
		['email'],
	);
	expect(toCreate).toEqual([]);
	expect(skippedDuplicate).toBe(1);
});

test('dedupeRecipesAgainstExisting keeps everything when nothing collides', () => {
	const { toCreate, skippedDuplicate } = dedupeRecipesAgainstExisting(
		[{ name: 'Email', instructions: 'x', icon: null }],
		['to-do list'],
	);
	expect(toCreate).toEqual([{ name: 'Email', instructions: 'x', icon: null }]);
	expect(skippedDuplicate).toBe(0);
});
