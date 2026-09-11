import { expect, test } from 'bun:test';
import { expectErr, expectOk } from 'wellcrafted/testing';
import { dedupeAgainstExisting, parseSnippetsImport } from './snippets-import';

test('parses a well-formed export', () => {
	const result = parseSnippetsImport(
		JSON.stringify([
			{ trigger: 'my address', replacement: '123 Main St' },
			{ trigger: 'my email', replacement: 'me@example.com' },
		]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([
		{ trigger: 'my address', replacement: '123 Main St' },
		{ trigger: 'my email', replacement: 'me@example.com' },
	]);
	expect(rejected).toBe(0);
});

test('rejects text that is not JSON', () => {
	const error = expectErr(parseSnippetsImport('not json'));
	expect(error).toEqual({ type: 'NotJson' });
});

test('rejects JSON that is not an array', () => {
	const error = expectErr(parseSnippetsImport('{"trigger":"x"}'));
	expect(error).toEqual({ type: 'NotAnArray' });
});

test('drops entries missing a trigger or replacement, keeps the rest', () => {
	const result = parseSnippetsImport(
		JSON.stringify([
			{ trigger: 'ok', replacement: 'fine' },
			{ trigger: '', replacement: 'no trigger' },
			{ trigger: 'no replacement', replacement: '' },
			{ trigger: 'wrong type', replacement: 42 },
			'not an object',
		]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([{ trigger: 'ok', replacement: 'fine' }]);
	expect(rejected).toBe(4);
});

test('drops an entry whose replacement exceeds the length cap', () => {
	const result = parseSnippetsImport(
		JSON.stringify([{ trigger: 'too long', replacement: 'x'.repeat(2001) }]),
	);
	const { valid, rejected } = expectOk(result);
	expect(valid).toEqual([]);
	expect(rejected).toBe(1);
});

test('trims trigger and replacement whitespace', () => {
	const result = parseSnippetsImport(
		JSON.stringify([
			{ trigger: '  my address  ', replacement: '  123 Main St  ' },
		]),
	);
	const { valid } = expectOk(result);
	expect(valid).toEqual([
		{ trigger: 'my address', replacement: '123 Main St' },
	]);
});

test('dedupeAgainstExisting skips a trigger already in the table, case-insensitively', () => {
	const { toCreate, skippedDuplicate } = dedupeAgainstExisting(
		[{ trigger: 'My Address', replacement: '123 Main St' }],
		['my address'],
	);
	expect(toCreate).toEqual([]);
	expect(skippedDuplicate).toBe(1);
});

test('dedupeAgainstExisting skips a repeat within the same file, keeping the first', () => {
	const { toCreate, skippedDuplicate } = dedupeAgainstExisting(
		[
			{ trigger: 'my address', replacement: 'first' },
			{ trigger: 'MY ADDRESS', replacement: 'second' },
		],
		[],
	);
	expect(toCreate).toEqual([{ trigger: 'my address', replacement: 'first' }]);
	expect(skippedDuplicate).toBe(1);
});

test('dedupeAgainstExisting keeps everything when nothing collides', () => {
	const { toCreate, skippedDuplicate } = dedupeAgainstExisting(
		[{ trigger: 'my address', replacement: '123 Main St' }],
		['my email'],
	);
	expect(toCreate).toEqual([
		{ trigger: 'my address', replacement: '123 Main St' },
	]);
	expect(skippedDuplicate).toBe(0);
});
