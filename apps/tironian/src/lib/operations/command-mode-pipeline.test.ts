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
import {
	correctionLearningFake,
	correctionLearningModule,
	resetCorrectionLearningFake,
} from './correction-learning.fake';
import { holdCursorContext } from './cursor-context-core';
import { expandSnippets } from './expand-snippets';
import { matchCommand, splitTrailingEnter } from './match-command';

let commandModeEnabled = true;
let transcript = 'scratch that';
let applies = true;
// Whether "press enter" can act, which is whether output writes at the cursor.
let enterApplies = true;
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
const transcribeAndPersist = mock(async (..._args: unknown[]) =>
	Ok({ text: transcript, history: Ok(undefined) }),
);
const runPolish = mock(
	async (
		_app: unknown,
		{ input }: { input: string; cursorContext?: unknown },
	) => Ok(willPolish ? 'Scratch that, please.' : input),
);
const reportInfo = mock();
const reportError = mock();
const recordLastDictation = mock();
const createRecording = mock((fields: Record<string, unknown>) => ({
	...fields,
	id: 'recording-1' as RecordingId,
}));

mock.module(
	'$lib/operations/correction-learning',
	() => correctionLearningModule,
);
mock.module('$lib/operations/expand-snippets', () => ({ expandSnippets }));
// The matcher is pure, so the real one runs here: a stub would hide the very
// coupling this file exists to check.
mock.module('$lib/operations/match-command', () => ({
	matchCommand,
	splitTrailingEnter,
}));
mock.module('$lib/operations/run-voice-command', () => ({
	commandApplies: (_app: unknown, id: string) =>
		id === 'pressEnter' ? enterApplies : applies,
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
	runPolish,
}));
mock.module('$lib/operations/sound', () => ({ playSoundIfEnabled }));
mock.module('$lib/operations/transcribe', () => ({ transcribeAndPersist }));
const saveRecordingHistory = mock(async () => Ok(undefined));
mock.module('$lib/operations/transcription-history', () => ({
	saveRecordingHistory,
}));
mock.module('$lib/report', () => ({
	log: { warn: mock() },
	report: {
		info: reportInfo,
		error: reportError,
		loading: () => ({ resolve: mock(), reject: mock() }),
	},
}));
mock.module('$lib/state/dictation-lifecycle.svelte', () => ({
	dictationLifecycle: {
		current: { outcome: { kind: 'transcribing' } },
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
mock.module('$lib/state/last-dictation.svelte', () => ({
	lastDictation: {
		record: recordLastDictation,
		peek: () => null,
		clear: mock(),
	},
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: { record: recordDelivery, take: mock(), clear: clearDelivery },
}));

const { processRecordingPipeline } = await import('./pipeline.js');
type TironianApp = import('$lib/app/app').TironianApp;

const app = {
	settings: {
		get: (key: string) =>
			key === 'commandModeEnabled' ? commandModeEnabled : false,
	},
	recordings: {
		create: createRecording,
		get: (id: string) => ({ id, transcript: '', polishedTranscript: null }),
		update: mock(async () => Ok(undefined)),
	},
	snippets: { all: [] },
} as unknown as TironianApp;

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
	enterApplies = true;
	willPolish = false;
	runVoiceCommand.mockClear();
	deliverTranscriptionResult.mockClear();
	clearDelivery.mockClear();
	playSoundIfEnabled.mockClear();
	recordDelivery.mockClear();
	dictationReset.mockClear();
	transcribeAndPersist.mockClear();
	runPolish.mockClear();
	reportInfo.mockClear();
	reportError.mockClear();
	recordLastDictation.mockClear();
	createRecording.mockClear();
	saveRecordingHistory.mockClear();
	resetCorrectionLearningFake();
	correctionLearningFake.wantsToObserve.mockReset();
	correctionLearningFake.wantsToObserve.mockImplementation(() => false);
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
		pressEnter: false,
		observeField: false,
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
		pressEnter: false,
		observeField: false,
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

test('a closing "press enter" ships the words without it and asks for Enter', async () => {
	transcript = 'Run the tests. Press enter.';
	saveRecordingHistory.mockClear();
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'Run the tests.',
		source: 'recording',
		pressEnter: true,
		observeField: false,
	});
	// Speed mode writes no polished text, but history must still show what
	// shipped rather than a phrase that was never typed.
	expect(saveRecordingHistory).toHaveBeenLastCalledWith(app, 'recording-1', {
		polishedTranscript: 'Run the tests.',
	});
});

test('Polish never sees a closing "press enter"', async () => {
	transcript = 'Run the tests. Press enter.';
	willPolish = true;
	await run();
	// The stub rewords whatever it gets, so what matters is the flag that
	// survived: the split happened before Polish could swallow the phrase.
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'Scratch that, please.',
		source: 'recording',
		pressEnter: true,
		observeField: false,
	});
});

test('a closing "press enter" stays text where Enter cannot act', async () => {
	transcript = 'Run the tests. Press enter.';
	enterApplies = false;
	await run();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'Run the tests. Press enter.',
		source: 'recording',
		pressEnter: false,
		observeField: false,
	});

	enterApplies = true;
	commandModeEnabled = false;
	await run();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'Run the tests. Press enter.',
		source: 'recording',
		pressEnter: false,
		observeField: false,
	});
});

test('a dictation the learner wants to watch is delivered observed and handed back to it', async () => {
	correctionLearningFake.wantsToObserve.mockImplementation(() => true);
	transcript = 'ordinary speech here';
	await run();
	expect(correctionLearningFake.wantsToObserve).toHaveBeenCalledWith(
		app,
		'ordinary speech here',
	);
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'ordinary speech here',
		source: 'recording',
		pressEnter: false,
		observeField: true,
	});
	expect(correctionLearningFake.afterDelivery).toHaveBeenCalledTimes(1);
	expect(correctionLearningFake.afterDelivery).toHaveBeenCalledWith(app, {
		deliveredText: 'ordinary speech here',
		observed: true,
		outcome: {
			reach: 'output',
			sinkKind: 'cursor',
			pressedEnter: false,
		},
	});
});

test('a dictation the learner declines is handed back as not observed', async () => {
	transcript = 'ordinary speech here';
	await run();
	expect(correctionLearningFake.afterDelivery).toHaveBeenCalledWith(
		app,
		expect.objectContaining({ observed: false }),
	);
});

test('an imported file is never observed or handed to the learner', async () => {
	correctionLearningFake.wantsToObserve.mockImplementation(() => true);
	transcript = 'ordinary speech here';
	await run('import');
	expect(correctionLearningFake.wantsToObserve).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(
		app,
		expect.objectContaining({ observeField: false }),
	);
	expect(correctionLearningFake.afterDelivery).not.toHaveBeenCalled();
});

const FIELD = {
	before: 'Zorv ZQXJ7731, blenta wuxo ',
	selection: '',
	after: ' quenta prulla, ZQXJ7731.',
};

function dictate(
	cursorContext: ReturnType<typeof holdCursorContext>,
	deliverySource: 'recording' | 'import' = 'recording',
) {
	return processRecordingPipeline(app, {
		audioBlobId: generateBlobId(),
		durationMs: 100,
		deliverySource,
		cursorContext,
	});
}

test('the text around the cursor reaches transcription and Polish, and nothing else', async () => {
	transcript = 'ordinary speech here';
	await dictate(holdCursorContext(FIELD));
	expect(transcribeAndPersist.mock.calls.at(-1)?.[3]).toEqual(
		expect.objectContaining({ cursorContext: FIELD }),
	);
	expect(runPolish.mock.calls.at(-1)?.[1]).toEqual(
		expect.objectContaining({ cursorContext: FIELD }),
	);
	const everywhereElse = JSON.stringify([
		createRecording.mock.calls,
		saveRecordingHistory.mock.calls,
		deliverTranscriptionResult.mock.calls,
		reportInfo.mock.calls,
		reportError.mock.calls,
		recordDelivery.mock.calls,
		recordLastDictation.mock.calls,
		correctionLearningFake.afterDelivery.mock.calls,
	]);
	expect(everywhereElse).not.toContain('ZQXJ7731');
});

test('the holder is empty before delivery starts, and again when the run ends', async () => {
	transcript = 'ordinary speech here';
	const holder = holdCursorContext(FIELD);
	let heldAtDelivery: unknown = 'not delivered';
	deliverTranscriptionResult.mockImplementationOnce(async () => {
		heldAtDelivery = holder?.read();
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
	await dictate(holder);
	expect(heldAtDelivery).toBeNull();
	expect(holder?.read()).toBeNull();
});

test('a run that never reaches Polish still empties the holder', async () => {
	// Silence.
	transcript = '   ';
	const silent = holdCursorContext(FIELD);
	await dictate(silent);
	expect(runPolish).not.toHaveBeenCalled();
	expect(silent?.read()).toBeNull();

	// A voice command.
	transcript = 'scratch that';
	const command = holdCursorContext(FIELD);
	await dictate(command);
	expect(runVoiceCommand).toHaveBeenCalledTimes(1);
	expect(command?.read()).toBeNull();

	// A throw out of the run.
	transcript = 'ordinary speech here';
	runPolish.mockImplementationOnce(async () => {
		throw new Error('boom');
	});
	const thrown = holdCursorContext(FIELD);
	await expect(dictate(thrown)).rejects.toThrow('boom');
	expect(thrown?.read()).toBeNull();
});

test('an imported file never carries the text around the cursor', async () => {
	transcript = 'ordinary speech here';
	const holder = holdCursorContext(FIELD);
	await dictate(holder, 'import');
	expect(transcribeAndPersist.mock.calls.at(-1)?.[3]).toEqual(
		expect.objectContaining({ cursorContext: null }),
	);
	expect(runPolish.mock.calls.at(-1)?.[1]).toEqual(
		expect.objectContaining({ cursorContext: null }),
	);
	expect(holder?.read()).toBeNull();
});

test('a dictation without it passes none on', async () => {
	transcript = 'ordinary speech here';
	await run();
	expect(transcribeAndPersist.mock.calls.at(-1)?.[3]).toEqual(
		expect.objectContaining({ cursorContext: null }),
	);
	expect(runPolish.mock.calls.at(-1)?.[1]).toEqual(
		expect.objectContaining({ cursorContext: null }),
	);
});
