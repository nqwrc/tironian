import { expect, test } from 'bun:test';
import { matchCommand, splitTrailingEnter } from './match-command';

test('matches the bare phrase', () => {
	expect(matchCommand('scratch that')).toBe('scratchThat');
	expect(matchCommand('undo that')).toBe('scratchThat');
	expect(matchCommand('stop listening')).toBe('stopListening');
	expect(matchCommand('Press enter.')).toBe('pressEnter');
	expect(matchCommand('Premi invio.')).toBe('pressEnter');
});

test('a closing "press enter" sentence splits off and the body keeps its punctuation', () => {
	const split = (text: string, body: string) =>
		expect(splitTrailingEnter(text)).toEqual({ body, pressEnter: true });
	split('Run the tests. Press enter.', 'Run the tests.');
	split('Done? press enter', 'Done?');
	split('Perché no? Premi invio!', 'Perché no?');
	split('Ok... PRESS  ENTER', 'Ok...');
	split('Ok… press enter.', 'Ok…');
	split('Fatto\nPremi invio', 'Fatto');
});

test('the phrase inside a sentence, a question, quotes or brackets stays text', () => {
	const unchanged = (text: string) =>
		expect(splitTrailingEnter(text)).toEqual({ body: text, pressEnter: false });
	// Instructions end in the phrase too; a misfire would submit them cut off.
	unchanged('Type your password and press enter.');
	unchanged('Open a terminal, type npm install, then press enter.');
	unchanged('Just press enter');
	unchanged('Scrivi la password e premi invio.');
	unchanged('Procedi pure, premi invio.');
	unchanged('What do I do? Press Enter?');
	unchanged('He said "press enter"');
	unchanged('Hello (press enter)');
	unchanged('Il comando è «premi invio»');
	unchanged('Done. repress enter');
	unchanged('Done. press enter twice to confirm');
	// Bare "invio" closes ordinary Italian sentences ("ti invio").
	unchanged('Ciao. Domani ti invio.');
});

test('the bare phrase is left to matchCommand, not split into nothing', () => {
	expect(splitTrailingEnter('Press enter.')).toEqual({
		body: 'Press enter.',
		pressEnter: false,
	});
});

test('absorbs what transcription adds around the phrase', () => {
	// A full stop is what Whisper appends to almost every utterance.
	expect(matchCommand('Scratch that.')).toBe('scratchThat');
	expect(matchCommand('  scratch that  ')).toBe('scratchThat');
	expect(matchCommand('scratch that!')).toBe('scratchThat');
	expect(matchCommand('...scratch that...')).toBe('scratchThat');
	expect(matchCommand('SCRATCH  THAT')).toBe('scratchThat');
	expect(matchCommand('scratch\nthat')).toBe('scratchThat');
});

test('internal punctuation is not stripped, so it must match the table', () => {
	expect(matchCommand('scratch, that')).toBeNull();
});

test('a phrase inside a sentence is content, not a command', () => {
	expect(matchCommand('scratch that idea')).toBeNull();
	expect(matchCommand('please stop listening')).toBeNull();
	expect(matchCommand('I told him to scratch that')).toBeNull();
});

test('empty and punctuation-only input match nothing', () => {
	expect(matchCommand('')).toBeNull();
	expect(matchCommand('   ')).toBeNull();
	expect(matchCommand('...')).toBeNull();
});

test('an inherited object key is not a command', () => {
	expect(matchCommand('constructor')).toBeNull();
	expect(matchCommand('toString')).toBeNull();
	expect(matchCommand('__proto__')).toBeNull();
});
