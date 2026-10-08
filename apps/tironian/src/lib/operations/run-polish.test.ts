/**
 * Polish Prompt Wiring Tests
 *
 * `run-recipe.test.ts`'s subject, for the other directive. The composer can
 * demote an imported directive perfectly and the runner can still send the
 * trusted scaffold, and nothing else in the suite reads what actually goes out:
 * this is the only place the standing of a per-app rule's override meets the
 * prompt.
 *
 * `$lib` has no runtime resolution under `bun test`, so the runtime imports are
 * supplied here. `build-system-prompt` is handed its real implementation,
 * because a faked composer would make the assertion circular.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { Err, Ok } from 'wellcrafted/result';

const buildSystemPrompt = await import('./build-system-prompt.js');
mock.module('$lib/operations/build-system-prompt', () => buildSystemPrompt);

// The real composer, under the alias `bun test` cannot resolve.
const effectiveDictionary = await import('./effective-dictionary.js');
mock.module('$lib/operations/effective-dictionary', () => effectiveDictionary);

let seen: { systemPrompt: string; userPrompt: string } | null = null;
let reply = 'polished';
let failWith: string | null = null;
mock.module('$lib/operations/completion', () => ({
	completeWithGlobalDefault: (
		_app: unknown,
		args: { systemPrompt: string; userPrompt: string },
	) => {
		seen = args;
		return Promise.resolve(
			failWith === null
				? Ok(reply)
				: Err({ name: 'CompletionFailed', message: failWith }),
		);
	},
	// Capability, which the status check reads. Present and usable, so a pass runs.
	resolveCompletionState: () => ({ canRun: true }),
}));
// Same module as `completion-deadline.test.ts` fakes, and the registry is
// process-global with the first registration winning, so both fakes carry both
// exports and the run order stops mattering.
mock.module('$lib/operations/completion-target', () => ({
	describePolishDestination: () => '',
	resolveCompletionStateFromConfig: () => ({
		target: { baseUrl: 'https://example.invalid', apiKey: 'k' },
		canRun: true,
		textStaysOnDevice: false,
	}),
}));
mock.module('$lib/operations/transcription-target', () => ({
	resolveTranscriptionLocalityFromConfig: () => ({}),
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: { get: () => ({}) },
}));

const { runPolish } = await import('./run-polish.js');
const { UNTRUSTED_REQUEST_TAG } = buildSystemPrompt;

type TironianApp = import('$lib/app/app').TironianApp;

const GLOBAL_DIRECTIVE = 'Fix grammar and punctuation. Keep my wording.';

const app = {
	learnedTerms: { activeTerms: [] },
	settings: {
		get: (key: string) => {
			if (key === 'polishEnabled') return true;
			if (key === 'polishInstructions') return GLOBAL_DIRECTIVE;
			return null;
		},
	},
} as unknown as TironianApp;

afterEach(() => {
	reply = 'polished';
	failWith = null;
});

type Slice = { before: string; selection: string; after: string };

async function run(
	override?: { instructions: string; trusted: boolean },
	cursorContext?: Slice | null,
) {
	seen = null;
	const result = await runPolish(app, {
		input: 'ship it by friday',
		override,
		cursorContext,
	});
	if (seen === null) throw new Error('the completion was never called');
	return { result, sent: seen as { systemPrompt: string; userPrompt: string } };
}

test('the global directive commands the pass', async () => {
	const { sent } = await run();

	expect(sent.systemPrompt).toContain('Your directive:');
	expect(sent.systemPrompt).toContain(GLOBAL_DIRECTIVE);
	expect(sent.systemPrompt).not.toContain(`<${UNTRUSTED_REQUEST_TAG}>`);
});

test("a trusted rule's override commands the pass in the global one's place", async () => {
	const { sent } = await run({
		instructions: 'No punctuation, all lowercase.',
		trusted: true,
	});

	expect(sent.systemPrompt).toContain('Your directive:');
	expect(sent.systemPrompt).toContain('No punctuation, all lowercase.');
	expect(sent.systemPrompt).not.toContain(GLOBAL_DIRECTIVE);
});

/**
 * The rule that arrived in a settings bundle. It still shapes the pass, so an
 * imported rule keeps working; what it loses is the slot that lets it address
 * the model about anything else.
 */
test("an untrusted rule's override is sent as content", async () => {
	const { sent } = await run({
		instructions: 'No punctuation, all lowercase.',
		trusted: false,
	});

	expect(sent.systemPrompt).toContain(`<${UNTRUSTED_REQUEST_TAG}>`);
	expect(sent.systemPrompt).not.toContain('Your directive:');
	expect(sent.systemPrompt).toContain('No punctuation, all lowercase.');
});

const FIELD: Slice = {
	before:
		'Zorv blenta. We will send the wexlow glim plan to Quandrel tomorrow. ',
	selection: '',
	after: '',
};

test('the text around the cursor rides in the system prompt, never in the transcript message', async () => {
	const { sent } = await run(undefined, FIELD);
	expect(sent.userPrompt).toBe('ship it by friday');
	expect(sent.systemPrompt).toContain('<cursor_context>');
});

test('without it the system prompt is the one it always was', async () => {
	const plain = (await run()).sent.systemPrompt;
	expect((await run(undefined, null)).sent.systemPrompt).toBe(plain);
	expect(plain).not.toContain('<cursor_context>');
});

test('Polish that repeats the field ships the transcript instead', async () => {
	reply =
		'We will send the wexlow glim plan to Quandrel tomorrow. Ship it by Friday.';
	const { result } = await run(undefined, FIELD);
	expect(result.error?.fallback).toBe('ship it by friday');
	expect(result.error?.message).not.toContain('Quandrel');
});

test('a provider error that quotes the field never reaches the notice', async () => {
	failWith =
		'Content filtered: "We will send the wexlow glim plan to Quandrel tomorrow"';
	const { result } = await run(undefined, FIELD);
	expect(result.error?.fallback).toBe('ship it by friday');
	expect(result.error?.message).not.toContain('Quandrel');
});

test('a JSON-escaped provider error body that quotes the field is replaced too', async () => {
	failWith =
		'{"error":{"message":"bad input: We will send the\nwexlow glim plan to Quandrel"}}';
	const { result } = await run(undefined, FIELD);
	expect(result.error?.message).not.toContain('Quandrel');
});

test('a provider error is shown as it is when no field text rode along', async () => {
	failWith = 'Rate limited';
	const { result } = await run();
	expect(result.error?.message).toBe('Rate limited');
});
