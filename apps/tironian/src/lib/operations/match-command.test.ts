import { expect, test } from 'bun:test';
import { matchCommand } from './match-command';

test('matches the bare phrase', () => {
	expect(matchCommand('scratch that')).toBe('scratchThat');
	expect(matchCommand('undo that')).toBe('scratchThat');
	expect(matchCommand('stop listening')).toBe('stopListening');
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
