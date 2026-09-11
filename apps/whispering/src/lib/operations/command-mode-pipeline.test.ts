/**
 * The pipeline branch Command Mode adds.
 *
 * What these lock down is the placement argument: a command intercepts the
 * transcript before Polish, before snippets, before the completion sound and
 * before delivery, and only when it is both enabled and applicable.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { generateBlobId } from '@tironian/blobs';
import { Ok } from 'wellcrafted/result';
import type { RecordingId } from '$lib/workspace';
import { expandSnippets } from './expand-snippets';
import { matchCommand } from './match-command';

let commandModeEnabled = true;
let transcript = 'scratch that';
let applies = true;
// Off by default, matching speed mode: most tests want the matcher's input to
// stay the raw transcript. Flipped on by the one test that proves Polish never
// gets a look at a phrase Command Mode is going to intercept.
let willPolish = false;
const runVoiceCommand = mock(async () => {});
const clearDelivery = mock();
const deliverTranscriptionResult = mock(async () => {
	// Mirrors what the real `deliverToSink` now does: every delivery clears
	// whatever was held before it, whether or not this call goes on to record a
	// new one.
	clearDelivery();
	return {
		outcome: {
			reach: 'output',
			sinkKind: 'cursor',
			pressedEnter: false,
		} as const,
		notice: { title: 'done' },
	};
});
const playSoundIfEnabled = mock(async () => Ok(undefined));
const recordDelivery = mock();
const dictationReset = mock();

mock.module('$lib/operations/expand-snippets', () => ({ expandSnippets }));
// The matcher is pure, so the real one runs here: a stub would hide the very
// coupling this file exists to check.
mock.module('$lib/operations/match-command', () => ({ matchCommand }));
mock.module('$lib/operations/run-voice-command', () => ({
	commandApplies: () => applies,
	runVoiceCommand,
}));
mock.module('$lib/operations/delivery', () => ({ deliverTranscriptionResult }));
mock.module('$lib/operations/run-recipe', () => ({
	runRecipe: mock(),
}));
mock.module('$lib/operations/run-polish', () => ({
	polishWillRun: () => willPolish,
	// Reworded regardless of input, so a test that turns Polish on can tell
	// whether the matcher ran before this (raw phrase, command fires) or after
	// (reworded prose, no phrase left to match).
	runPolish: async (_app: unknown, { input }: { input: string }) =>
		Ok(willPolish ? 'Scratch that, please.' : input),
}));
mock.module('$lib/operations/sound', () => ({ playSoundIfEnabled }));
mock.module('$lib/operations/transcribe', () => ({
	transcribeAndPersist: async () =>
		Ok({ text: transcript, history: Ok(undefined) }),
}));
mock.module('$lib/operations/transcription-history', () => ({
	saveRecordingHistory: mock(async () => Ok(undefined)),
}));
mock.module('$lib/report', () => ({
	log: { warn: mock() },
	report: {
		info: mock(),
		error: mock(),
		loading: () => ({ resolve: mock(), reject: mock() }),
	},
}));
mock.module('$lib/state/dictation-lifecycle.svelte', () => ({
	dictationLifecycle: {
		reset: dictationReset,
		markTranscribing: mock(),
		markFailed: mock(),
		markPolishing: mock(),
		markDelivered: mock(),
	},
}));
mock.module('$lib/state/polish-hud.svelte', () => ({
	polishHud: { begin: mock(), end: mock() },
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: { record: recordDelivery, take: mock(), clear: clearDelivery },
}));

const { processRecordingPipeline } = await import('./pipeline.js');
type WhisperingApp = import('$lib/whispering/app').WhisperingApp;

const app = {
	settings: {
		get: (key: string) =>
			key === 'commandModeEnabled' ? commandModeEnabled : false,
	},
	recordings: {
		create: (fields: Record<string, unknown>) => ({
			...fields,
			id: 'recording-1' as RecordingId,
		}),
		update: mock(async () => Ok(undefined)),
	},
	snippets: { all: [] },
} as unknown as WhisperingApp;

function run(deliverySource: 'recording' | 'import' = 'recording') {
	return processRecordingPipeline(app, {
		audioBlobId: generateBlobId(),
		durationMs: 100,
		deliverySource,
	});
}

afterEach(() => {
	commandModeEnabled = true;
	transcript = 'scratch that';
	applies = true;
	willPolish = false;
	runVoiceCommand.mockClear();
	deliverTranscriptionResult.mockClear();
	clearDelivery.mockClear();
	playSoundIfEnabled.mockClear();
	recordDelivery.mockClear();
	dictationReset.mockClear();
});

test('a command runs instead of being delivered', async () => {
	await run();
	expect(runVoiceCommand).toHaveBeenCalledTimes(1);
	expect(runVoiceCommand).toHaveBeenLastCalledWith(app, 'scratchThat');
	expect(deliverTranscriptionResult).not.toHaveBeenCalled();
	// No text arrived anywhere, so there is no receipt to sound.
	expect(playSoundIfEnabled).not.toHaveBeenCalled();
	// A command delivers no text, so the "Transcribing" marker set on the way in
	// must be cleared, or the pill spins forever on work that already finished.
	expect(dictationReset).toHaveBeenCalledTimes(1);
});

test('ordinary speech is untouched', async () => {
	transcript = 'scratch that idea and move on';
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenCalledTimes(1);
});

test('the setting gates the whole branch', async () => {
	commandModeEnabled = false;
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'scratch that',
		source: 'recording',
	});
});

test('an inapplicable command delivers as text instead of vanishing', async () => {
	transcript = 'stop listening';
	applies = false;
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'stop listening',
		source: 'recording',
	});
});

test('an imported file never fires a command', async () => {
	await run('import');
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenCalledTimes(1);
});

test('a command still fires even though Polish would have reworded it', async () => {
	transcript = 'scratch that';
	willPolish = true;
	await run();
	expect(runVoiceCommand).toHaveBeenCalledTimes(1);
	expect(runVoiceCommand).toHaveBeenLastCalledWith(app, 'scratchThat');
	// If the matcher ran after Polish, it would see "Scratch that, please." and
	// never match, so a delivery here would mean the branch moved.
	expect(deliverTranscriptionResult).not.toHaveBeenCalled();
});

test('a delivered dictation is held for undo, an import clears without re-holding', async () => {
	transcript = 'hello world';
	await run();
	expect(clearDelivery).toHaveBeenCalledTimes(1);
	expect(recordDelivery).toHaveBeenCalledTimes(1);
	expect(recordDelivery).toHaveBeenLastCalledWith({
		text: 'hello world',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
	});

	clearDelivery.mockClear();
	recordDelivery.mockClear();
	await run('import');
	// The seam clears whatever was held on every delivery, and the pipeline only
	// re-records for a real dictation, so an import leaves nothing held rather
	// than the stale record from the dictation above.
	expect(clearDelivery).toHaveBeenCalledTimes(1);
	expect(recordDelivery).not.toHaveBeenCalled();
});
