import { expect, test } from 'bun:test';
import { foldTerm, foldText, tokenizeWords } from './words';

test('fold drops case and accents', () => {
	expect(foldText('Perché')).toBe('perche');
	expect(foldText('Nicolò')).toBe('nicolo');
	expect(foldText('GitHub')).toBe('github');
});

test('tokens lose edge punctuation and keep inner punctuation', () => {
	expect(
		tokenizeWords('Uso Node.js, poi «Svelte»!').map((w) => w.surface),
	).toEqual(['Uso', 'Node.js', 'poi', 'Svelte']);
});

test('pure punctuation tokens vanish', () => {
	expect(tokenizeWords('Ok - fatto ...').map((w) => w.surface)).toEqual([
		'Ok',
		'fatto',
	]);
});

test('sentence ends are marked on the raw token', () => {
	expect(tokenizeWords('Done. Next one').map((w) => w.endsSentence)).toEqual([
		true,
		false,
		false,
	]);
});

test('carriage returns split words like any whitespace', () => {
	expect(tokenizeWords('Dear Ann,\r\nsee you').map((w) => w.surface)).toEqual([
		'Dear',
		'Ann',
		'see',
		'you',
	]);
});

test('foldTerm collapses whitespace', () => {
	expect(foldTerm('  Nicola   Pandolfi ')).toBe('nicola pandolfi');
});
