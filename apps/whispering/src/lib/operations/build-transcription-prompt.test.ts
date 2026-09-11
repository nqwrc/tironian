import { describe, expect, test } from 'bun:test';
import {
	buildTranscriptionPrompt,
	recognizerPromptCharBudget,
	WHISPER_PROMPT_CHAR_BUDGET,
} from './build-transcription-prompt';

/** A Whisper route's budget: 224 tokens at 3 conservative characters each. */
const BUDGET = WHISPER_PROMPT_CHAR_BUDGET;

describe('recognizerPromptCharBudget', () => {
	test('bounds the routes that decode this string as a Whisper prompt', () => {
		expect(recognizerPromptCharBudget('Groq', null)).toBe(BUDGET);
		expect(recognizerPromptCharBudget('local', null)).toBe(BUDGET);
		expect(recognizerPromptCharBudget('speaches', null)).toBe(BUDGET);
	});

	test('leaves the routes that are not Whisper decoders unbounded', () => {
		// Deepgram appends this as a keyterm query parameter; ElevenLabs and Mistral
		// never put it on the wire at all. Clipping any of them removes terms for a
		// ceiling that is not theirs.
		expect(recognizerPromptCharBudget('Deepgram', null)).toBeNull();
		expect(recognizerPromptCharBudget('ElevenLabs', null)).toBeNull();
		expect(recognizerPromptCharBudget('Mistral', null)).toBeNull();
	});

	test("reads OpenAI's model, whose menu spans both shapes", () => {
		expect(recognizerPromptCharBudget('OpenAI', 'whisper-1')).toBe(BUDGET);
		expect(
			recognizerPromptCharBudget('OpenAI', 'gpt-4o-transcribe'),
		).toBeNull();
		expect(
			recognizerPromptCharBudget('OpenAI', 'gpt-4o-mini-transcribe'),
		).toBeNull();
		// An endpoint override can put any model name here, and an unknown one goes
		// unbounded rather than losing terms to a ceiling it may not have.
		expect(recognizerPromptCharBudget('OpenAI', 'some-local-build')).toBeNull();
		expect(recognizerPromptCharBudget('OpenAI', null)).toBeNull();
	});
});

describe('buildTranscriptionPrompt', () => {
	test('returns the trimmed user prompt when the dictionary is null', () => {
		const result = buildTranscriptionPrompt(
			'  Spell names carefully.  ',
			null,
			BUDGET,
		);
		expect(result.prompt).toBe('Spell names carefully.');
		expect(result.dropped).toEqual([]);
	});

	test('returns the trimmed user prompt when the dictionary is empty', () => {
		const result = buildTranscriptionPrompt(
			'  Spell names carefully.  ',
			[],
			BUDGET,
		);
		expect(result.prompt).toBe('Spell names carefully.');
		expect(result.dropped).toEqual([]);
	});

	test('emits the glossary alone when there is no user prompt', () => {
		const result = buildTranscriptionPrompt(
			'',
			['Kubernetes', 'Braden'],
			BUDGET,
		);
		// No leading space, and terms joined by the separator the recognizer sees.
		expect(result.prompt).toBe('Kubernetes, Braden');
		expect(result.dropped).toEqual([]);
	});

	test('joins the user prompt and the glossary when both fit', () => {
		const result = buildTranscriptionPrompt(
			'  Technical talk.  ',
			['Kubernetes', 'Braden'],
			BUDGET,
		);
		// The user prompt is trimmed, then one space joins it to the glossary.
		expect(result.prompt).toBe('Technical talk. Kubernetes, Braden');
		expect(result.dropped).toEqual([]);
	});

	test('keeps every term on an unbounded route', () => {
		// The Deepgram, ElevenLabs, Mistral and gpt-4o-transcribe case: no Whisper
		// ceiling, so a dictionary far past 672 characters still goes out whole and
		// the page has nothing to warn about.
		const terms = Array.from({ length: 400 }, (_, i) => `Term${i}`);
		const result = buildTranscriptionPrompt('Technical talk.', terms, null);

		expect(result.prompt.length).toBeGreaterThan(BUDGET);
		expect(result.dropped).toEqual([]);
		for (const term of terms) expect(result.prompt).toContain(term);
	});

	test('bounds an oversized dictionary and reports the contiguous tail', () => {
		const terms = Array.from({ length: 400 }, (_, i) => `Term${i}`);
		const result = buildTranscriptionPrompt('Technical talk.', terms, BUDGET);

		expect(result.prompt.length).toBeLessThanOrEqual(BUDGET);
		expect(result.dropped.length).toBeGreaterThan(0);
		// What was kept and what was dropped reconstruct the input exactly, which
		// pins both the contiguous-tail property and the preserved order: nothing is
		// reordered, deduped, or skipped over.
		const kept = terms.slice(0, terms.length - result.dropped.length);
		expect([...kept, ...result.dropped]).toEqual(terms);
	});

	test('never emits a partial term', () => {
		// Terms sharing a prefix catch a substring bug: a truncated `Kubernetes`
		// would still look present to a naive `toContain('Kubernet')`.
		const terms = [
			'Kubernet',
			'Kubernetes',
			...Array.from({ length: 400 }, (_, i) => `Namespace${i}`),
		];
		const result = buildTranscriptionPrompt('Technical talk.', terms, BUDGET);

		const glossary = result.prompt.slice('Technical talk. '.length);
		for (const emitted of glossary.split(', ')) {
			expect(terms).toContain(emitted);
		}
		// A dropped term must not appear anywhere in the emitted string, not even
		// as the head of a longer one.
		for (const term of result.dropped) {
			expect(result.prompt).not.toContain(term);
		}
	});

	test('keeps the whole user prompt and drops every term when it fills the budget', () => {
		const userPrompt = 'x'.repeat(BUDGET);
		const terms = ['Kubernetes', 'Braden'];
		const result = buildTranscriptionPrompt(`  ${userPrompt}  `, terms, BUDGET);

		// The sentence the person typed is never shortened for a glossary.
		expect(result.prompt).toBe(userPrompt);
		expect(result.dropped).toEqual(terms);
		for (const term of terms) expect(result.prompt).not.toContain(term);
	});

	test('emits no glossary when the very first term exceeds the budget', () => {
		const terms = ['A'.repeat(BUDGET + 1), 'Ada'];
		const result = buildTranscriptionPrompt('Technical talk.', terms, BUDGET);

		expect(result.prompt).toBe('Technical talk.');
		expect(result.dropped).toEqual(terms);
	});

	test('stops at the first term that does not fit, never reaching past it', () => {
		const first = 'A'.repeat(600);
		const second = 'B'.repeat(500);
		const result = buildTranscriptionPrompt(
			'Hi.',
			[first, second, 'Ada'],
			BUDGET,
		);

		// The 600-char term fits after a 3-char prompt; the 500-char one does not,
		// and the short `Ada` behind it is not pulled forward into the gap.
		expect(result.prompt).toBe(`Hi. ${first}`);
		expect(result.dropped).toEqual([second, 'Ada']);
		expect(result.prompt).not.toContain('Ada');
	});
});
