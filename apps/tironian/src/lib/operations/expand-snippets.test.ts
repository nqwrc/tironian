import { expect, test } from 'bun:test';
import { expandSnippets, type SnippetRule } from './expand-snippets';

const rule = (
	id: string,
	trigger: string,
	replacement: string,
): SnippetRule => ({
	id,
	trigger,
	replacement,
});

const ADDRESS = rule('s1', 'my address', '123 Main Street');

test('expands a trigger in the middle of a sentence', () => {
	expect(expandSnippets('Send it to my address today', [ADDRESS])).toBe(
		'Send it to 123 Main Street today',
	);
});

test('expands a trigger at the end of the input', () => {
	expect(expandSnippets('Send it to my address', [ADDRESS])).toBe(
		'Send it to 123 Main Street',
	);
});

test('matches case-insensitively and inserts the saved casing', () => {
	expect(expandSnippets('My Address is fine', [ADDRESS])).toBe(
		'123 Main Street is fine',
	);
});

test('a longer trigger wins over a shorter one that also matches', () => {
	const rules = [ADDRESS, rule('s2', 'my work address', '9 Office Park')];
	expect(expandSnippets('use my work address', rules)).toBe(
		'use 9 Office Park',
	);
});

test('equal-length triggers resolve by row id, not table order', () => {
	const first = rule('s1', 'aa bb', 'FIRST');
	const second = rule('s2', 'aa bb', 'SECOND');
	expect(expandSnippets('aa bb', [second, first])).toBe('FIRST');
});

test('inserted text is never rescanned for triggers', () => {
	const rules = [rule('s1', 'sign off', 'Regards, my address'), ADDRESS];
	expect(expandSnippets('sign off', rules)).toBe('Regards, my address');
});

test('a two-snippet cycle terminates instead of hanging', () => {
	const rules = [rule('s1', 'alpha', 'beta'), rule('s2', 'beta', 'alpha')];
	expect(expandSnippets('alpha beta', rules)).toBe('beta alpha');
});

test('trailing punctuation added by Polish still matches', () => {
	expect(expandSnippets('Send it to my address.', [ADDRESS])).toBe(
		'Send it to 123 Main Street.',
	);
});

test('a trigger inside a longer word does not match', () => {
	expect(
		expandSnippets('addressable market', [rule('s1', 'address', 'X')]),
	).toBe('addressable market');
});

test('an empty or whitespace-only trigger is inert', () => {
	const rules = [rule('s1', '', 'BAD'), rule('s2', '   ', 'ALSO BAD')];
	expect(expandSnippets('leave this alone', rules)).toBe('leave this alone');
});

test('an empty snippet table and an empty transcript are no-ops', () => {
	expect(expandSnippets('untouched', [])).toBe('untouched');
	expect(expandSnippets('', [ADDRESS])).toBe('');
});
