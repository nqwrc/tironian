import { describe, expect, test } from 'bun:test';
import {
	buildTranscriptionPrompt,
	PRECEDING_TEXT_MAX_CHARS,
	PRECEDING_TEXT_MIN_CHARS,
	recognizerPromptCharBudget,
	recognizerTakesPrecedingText,
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

describe('recognizerTakesPrecedingText', () => {
	test('Whisper-style routes read the prompt as the transcript so far', () => {
		for (const service of ['local', 'Groq', 'speaches', 'OpenAI'] as const) {
			expect(recognizerTakesPrecedingText(service)).toBe(true);
		}
	});

	test('keyterm routes and routes that drop the prompt never get it', () => {
		for (const service of ['Deepgram', 'ElevenLabs', 'Mistral'] as const) {
			expect(recognizerTakesPrecedingText(service)).toBe(false);
		}
	});
});

describe('buildTranscriptionPrompt, text before the cursor', () => {
	const accented = 'Zorv blenta wuxo, perché la quenta è già prulla da ';

	test('alone, it is the prompt', () => {
		expect(
			buildTranscriptionPrompt('', null, WHISPER_PROMPT_CHAR_BUDGET, accented),
		).toEqual({ prompt: accented.trim(), dropped: [] });
	});

	test('it follows the user prompt and the Dictionary on its own line', () => {
		expect(
			buildTranscriptionPrompt(
				'Italian business email.',
				['Kubernetes', 'Jira'],
				WHISPER_PROMPT_CHAR_BUDGET,
				'Plonk the zibbo flarn. ',
			),
		).toEqual({
			prompt:
				'Italian business email. Kubernetes, Jira\nPlonk the zibbo flarn.',
			dropped: [],
		});
	});

	test('it never displaces a Dictionary term', () => {
		const terms = ['a'.repeat(660), 'Jira'];
		const without = buildTranscriptionPrompt(
			'',
			terms,
			WHISPER_PROMPT_CHAR_BUDGET,
		);
		expect(
			buildTranscriptionPrompt('', terms, WHISPER_PROMPT_CHAR_BUDGET, accented),
		).toEqual(without);
	});

	test('it fills what the budget leaves, from a whole word to the cursor', () => {
		const term = 'k'.repeat(600);
		const text =
			'Zorv blenta wuxo, perché la quenta è già prulla da jarmex e la flonda vrelta quasi ogni giorno, ';
		const { prompt, dropped } = buildTranscriptionPrompt(
			'',
			[term],
			WHISPER_PROMPT_CHAR_BUDGET,
			text,
		);
		expect(dropped).toEqual([]);
		expect(prompt.length).toBeLessThanOrEqual(WHISPER_PROMPT_CHAR_BUDGET);
		expect(prompt.startsWith(`${term}\n`)).toBe(true);
		const tail = prompt.slice(term.length + 1);
		expect(tail.length).toBeGreaterThanOrEqual(PRECEDING_TEXT_MIN_CHARS);
		expect(text.trim().endsWith(tail)).toBe(true);
		const cutAt = text.trim().length - tail.length;
		expect(/\s/.test(text.trim().charAt(cutAt - 1))).toBe(true);
	});

	test('an unbounded route still takes at most 400 characters of it', () => {
		const { prompt } = buildTranscriptionPrompt(
			'',
			['Kubernetes'],
			null,
			'blorp '.repeat(200),
		);
		const tail = prompt.slice('Kubernetes\n'.length);
		expect(tail.length).toBeLessThanOrEqual(PRECEDING_TEXT_MAX_CHARS);
		expect(tail.startsWith('blorp')).toBe(true);
	});

	/** The budget's own estimate of a prompt: ASCII at 3 to a token, the rest at 1. */
	function estimatedTokens(text: string): number {
		let ascii = 0;
		let other = 0;
		for (const char of text) {
			if (char.charCodeAt(0) < 0x80) ascii += 1;
			else other += 1;
		}
		return ascii / 3 + other;
	}

	test.each([
		['Russian', 'Это вымышленный текст про зорв блента вуксо, '.repeat(12)],
		['Chinese', '这是虚构的文字关于佐尔夫布伦塔乌克索，'.repeat(20)],
	])('%s text before the cursor cannot push the Dictionary out of the window', (_name, text) => {
		const terms = ['Kubernetes', 'Jira'];
		const without = buildTranscriptionPrompt(
			'Spell names carefully.',
			terms,
			WHISPER_PROMPT_CHAR_BUDGET,
		);
		const { prompt, dropped } = buildTranscriptionPrompt(
			'Spell names carefully.',
			terms,
			WHISPER_PROMPT_CHAR_BUDGET,
			text,
		);
		expect(dropped).toEqual([]);
		expect(
			prompt.startsWith(`${without.prompt}
`),
		).toBe(true);
		const tail = prompt.slice(without.prompt.length + 1);
		expect(tail.length).toBeGreaterThan(0);
		expect(text.trim().endsWith(tail)).toBe(true);
		expect(estimatedTokens(prompt)).toBeLessThanOrEqual(224);
	});

	test('an ASCII slice is still measured in characters, not tokens', () => {
		const { prompt } = buildTranscriptionPrompt(
			'',
			null,
			WHISPER_PROMPT_CHAR_BUDGET,
			'blorp '.repeat(200),
		);
		expect(prompt.length).toBeGreaterThan(300);
		expect(prompt.length).toBeLessThanOrEqual(PRECEDING_TEXT_MAX_CHARS);
	});

	test('no text, or only whitespace, changes nothing', () => {
		for (const nothing of [null, '', '   \n']) {
			expect(
				buildTranscriptionPrompt(
					'Meeting notes.',
					['Kubernetes'],
					WHISPER_PROMPT_CHAR_BUDGET,
					nothing,
				),
			).toEqual(
				buildTranscriptionPrompt(
					'Meeting notes.',
					['Kubernetes'],
					WHISPER_PROMPT_CHAR_BUDGET,
				),
			);
		}
	});
});
