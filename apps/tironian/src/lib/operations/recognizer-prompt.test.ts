/**
 * Which recognizer routes get the text before the cursor (ADR-0272). The
 * composer takes plain values, so no module is mocked; `transcribe.ts` calls
 * it with the route it is about to run.
 */
import { expect, test } from 'bun:test';
import { TRANSCRIPTION_SERVICE_IDS } from '../services/transcription/provider-ids';
import type { CursorContext } from './cursor-context-core';
import { composeRecognizerPrompt } from './recognizer-prompt';

const FIELD: CursorContext = {
	before: 'Zorv blenta wuxo, la quenta è già prulla da jarmex ',
	selection: 'SELECTED-SENTINEL',
	after: 'AFTER-SENTINEL',
};

function promptFor(
	service: (typeof TRANSCRIPTION_SERVICE_IDS)[number],
	model: string | null,
	cursorContext: CursorContext | null,
) {
	return composeRecognizerPrompt({
		userPrompt: 'Spell names carefully.',
		dictionary: ['Vorplex'],
		service,
		model,
		cursorContext,
	}).prompt;
}

test('Whisper-style routes get the text before the cursor, and only that', () => {
	for (const [service, model] of [
		['local', null],
		['Groq', null],
		['speaches', null],
		['OpenAI', 'whisper-1'],
		['OpenAI', 'gpt-4o-transcribe'],
		['OpenAI', 'gpt-4o-mini-transcribe'],
	] as const) {
		const prompt = promptFor(service, model, FIELD);
		expect(prompt).toContain('Zorv blenta wuxo');
		expect(prompt).not.toContain('SELECTED-SENTINEL');
		expect(prompt).not.toContain('AFTER-SENTINEL');
	}
});

test('routes that are not Whisper-style never get any of the field', () => {
	for (const service of ['Deepgram', 'ElevenLabs', 'Mistral'] as const) {
		const prompt = promptFor(service, null, FIELD);
		expect(prompt).toBe(promptFor(service, null, null));
		expect(prompt).not.toContain('Zorv');
	}
});

test('every route is decided: the ones that take it match the ones that do not', () => {
	const takers = TRANSCRIPTION_SERVICE_IDS.filter((service) =>
		promptFor(service, null, FIELD).includes('Zorv'),
	);
	expect(takers.sort()).toEqual(['Groq', 'OpenAI', 'local', 'speaches']);
});

test('without a slice the prompt is the one it always was', () => {
	for (const service of TRANSCRIPTION_SERVICE_IDS) {
		expect(promptFor(service, null, null)).toBe(
			'Spell names carefully. Vorplex',
		);
	}
});
