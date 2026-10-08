/**
 * The prompts as they were before the text around the cursor existed
 * (ADR-0272). With the switch off, with nothing readable, or with only blank
 * text around the cursor, every composer must produce these bytes exactly.
 *
 * The snapshot was written from `main` before the feature. Update it only for
 * a deliberate prompt change, never to make a cursor-context change pass.
 */
import { expect, test } from 'bun:test';
import {
	buildPolishSystemPrompt,
	buildRecipeSystemPrompt,
} from './build-system-prompt';
import {
	buildTranscriptionPrompt,
	WHISPER_PROMPT_CHAR_BUDGET,
} from './build-transcription-prompt';

const DIRECTIVE = 'Fix grammar and punctuation. Keep my wording.';
const DICTIONARIES: (readonly string[] | null)[] = [
	null,
	[],
	['Kubernetes', 'Jira', 'Brandolin'],
];

test('Polish system prompts', () => {
	const build = (
		cursorContext?: { before: string; selection: string; after: string } | null,
	) =>
		DICTIONARIES.flatMap((dictionary) =>
			[true, false].map((trusted) =>
				buildPolishSystemPrompt(DIRECTIVE, dictionary, {
					trusted,
					cursorContext,
				}),
			),
		);
	const prompts = build();
	expect(build(null)).toEqual(prompts);
	expect(build({ before: '  \n', selection: '', after: ' ' })).toEqual(prompts);
	expect(prompts).toMatchSnapshot();
});

test('Recipe system prompts', () => {
	const prompts = DICTIONARIES.flatMap((dictionary) =>
		[true, false].map((trusted) =>
			buildRecipeSystemPrompt('Turn this into an email.', dictionary, {
				trusted,
			}),
		),
	);
	expect(prompts).toMatchSnapshot();
});

const RECOGNIZER_CASES: [string, readonly string[] | null, number | null][] = [
	['', null, WHISPER_PROMPT_CHAR_BUDGET],
	[
		'Italian business email.',
		['Kubernetes', 'Jira'],
		WHISPER_PROMPT_CHAR_BUDGET,
	],
	['', ['a'.repeat(660), 'Jira'], WHISPER_PROMPT_CHAR_BUDGET],
	['Meeting notes.', ['Kubernetes'], null],
];

test('recognizer prompts', () => {
	const prompts = RECOGNIZER_CASES.map(([userPrompt, dictionary, budget]) =>
		buildTranscriptionPrompt(userPrompt, dictionary, budget),
	);
	for (const nothing of [null, '', '  \n ']) {
		expect(
			RECOGNIZER_CASES.map(([userPrompt, dictionary, budget]) =>
				buildTranscriptionPrompt(userPrompt, dictionary, budget, nothing),
			),
		).toEqual(prompts);
	}
	expect(prompts).toMatchSnapshot();
});
