import { beforeEach, expect, test } from 'bun:test';
import { lastDictation } from './last-dictation.svelte';

const held = (
	overrides: Partial<Parameters<typeof lastDictation.record>[0]>,
) => ({
	text: 'Ciao Marco, a domani.',
	recordingId: 'r1',
	transcript: 'ciao marco a domani',
	polishedTranscript: 'Ciao Marco, a domani.',
	...overrides,
});

beforeEach(() => lastDictation.clear());

test('holds nothing until a dictation is recorded', () => {
	expect(lastDictation.peek()).toBeNull();
});

test('peek does not consume', () => {
	lastDictation.record(held({}));
	expect(lastDictation.peek()).toEqual(held({}));
	expect(lastDictation.peek()).not.toBeNull();
});

test('keeps the row snapshot beside the text', () => {
	lastDictation.record(held({ polishedTranscript: null }));
	expect(lastDictation.peek()?.transcript).toBe('ciao marco a domani');
	expect(lastDictation.peek()?.polishedTranscript).toBeNull();
});

test('a newer dictation replaces the older one', () => {
	lastDictation.record(held({ text: 'first', recordingId: 'r1' }));
	lastDictation.record(held({ text: 'second', recordingId: 'r2' }));
	expect(lastDictation.peek()?.recordingId).toBe('r2');
});

test('whitespace-only text holds nothing, so the chord never pastes blanks', () => {
	lastDictation.record(held({ text: 'first', recordingId: 'r1' }));
	lastDictation.record(held({ text: '  \n', recordingId: 'r2' }));
	expect(lastDictation.peek()).toBeNull();
});
