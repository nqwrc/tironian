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
import { expect, mock, test } from 'bun:test';
import { Ok } from 'wellcrafted/result';

const buildSystemPrompt = await import('./build-system-prompt.js');
mock.module('$lib/operations/build-system-prompt', () => buildSystemPrompt);

let seen: { systemPrompt: string; userPrompt: string } | null = null;
mock.module('$lib/operations/completion', () => ({
	completeWithGlobalDefault: (
		_app: unknown,
		args: { systemPrompt: string; userPrompt: string },
	) => {
		seen = args;
		return Promise.resolve(Ok('polished'));
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
	settings: {
		get: (key: string) => {
			if (key === 'polishEnabled') return true;
			if (key === 'polishInstructions') return GLOBAL_DIRECTIVE;
			return null;
		},
	},
} as unknown as TironianApp;

async function run(override?: { instructions: string; trusted: boolean }) {
	seen = null;
	const result = await runPolish(app, { input: 'ship it by friday', override });
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
