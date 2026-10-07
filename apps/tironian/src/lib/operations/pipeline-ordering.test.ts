/**
 * Recording Pipeline Ordering Tests
 *
 * The pipeline serializes its runs. Every acquisition path reaches the same
 * cursor, and only one of them can be writing to it at a time.
 *
 * Key behaviors:
 * - Two runs started without awaiting the first deliver in call order, even
 *   when the second transcribes faster than the first
 * - `lastDelivery` is left holding the run that actually delivered last, which
 *   is what "scratch that" backspaces
 * - A failed run does not poison the queue for the runs behind it
 * - A run that throws mid-dictation marks the lifecycle failed, so the pill
 *   and the repeat commands are not left reading `transcribing`
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { generateBlobId } from '@tironian/blobs';
import { Err, Ok } from 'wellcrafted/result';
import type { RecordingId } from '$lib/workspace';
import { expandSnippets } from './expand-snippets';

/** Milliseconds each successive `transcribeAndPersist` call waits before returning. */
let transcriptionDelaysMs: number[] = [];
/** Text each successive call resolves to, so delivery order is readable. */
let transcripts: string[] = [];
/** Call indexes that should throw instead of resolving. */
let failingRuns: number[] = [];
let transcribeCalls = 0;

const delivered: string[] = [];
/** Whether the next delivery reports the secure-field guard withheld it. */
let withheld = false;
const deliverTranscriptionResult = mock(async ({ text }: { text: string }) => {
	delivered.push(text);
	return {
		outcome: {
			reach: 'output',
			sinkKind: 'cursor',
			pressedEnter: false,
			withheld,
		} as const,
		notice: { title: 'done' },
	};
});
const record = mock();
const recordDictation = mock();

mock.module('$lib/operations/expand-snippets', () => ({ expandSnippets }));
// Command mode is off in this fixture: these exist so the pipeline's own
// imports resolve under bun, which cannot follow the `$lib` alias here.
mock.module('$lib/operations/match-command', () => ({
	matchCommand: () => null,
}));
mock.module('$lib/operations/run-voice-command', () => ({
	commandApplies: () => false,
	runVoiceCommand: mock(),
}));
mock.module('$lib/operations/delivery', () => ({
	deliverTranscriptionResult: (_app: unknown, args: { text: string }) =>
		deliverTranscriptionResult(args),
}));
mock.module('$lib/operations/run-recipe', () => ({ runRecipe: mock() }));
mock.module('$lib/operations/run-polish', () => ({
	polishWillRun: () => false,
	runPolish: async (_app: unknown, { input }: { input: string }) => Ok(input),
}));
mock.module('$lib/operations/sound', () => ({
	playSoundIfEnabled: mock(async () => Ok(undefined)),
}));
mock.module('$lib/operations/transcribe', () => ({
	transcribeAndPersist: async () => {
		const index = transcribeCalls++;
		const delay = transcriptionDelaysMs[index] ?? 0;
		if (delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
		if (failingRuns.includes(index)) {
			throw new Error(`transcription ${index} failed`);
		}
		return Ok({
			text: transcripts[index] ?? 'transcript',
			history: Ok(undefined),
		});
	},
}));
mock.module('$lib/operations/transcription-history', () => ({
	saveRecordingHistory: mock(async () => Ok(undefined)),
}));
mock.module('$lib/report', () => ({
	log: { warn: mock(), info: mock() },
	report: {
		info: mock(),
		error: mock(),
		loading: () => ({ resolve: mock(), reject: mock() }),
	},
}));
/** What the lifecycle outcome reads, driven by the markers the fake receives. */
let outcomeKind = 'none';
const markFailed = mock((_failure: { tier: string }) => {
	outcomeKind = 'failed';
});
mock.module('$lib/state/dictation-lifecycle.svelte', () => ({
	dictationLifecycle: {
		get current() {
			return { capture: { kind: 'idle' }, outcome: { kind: outcomeKind } };
		},
		markTranscribing: mock(() => {
			outcomeKind = 'transcribing';
		}),
		markFailed,
		markPolishing: mock(),
		markDelivered: mock(),
		markWithheld: mock(),
	},
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: {
		record,
		clear: mock(),
		canUndo: () => false,
		take: () => null,
	},
}));
mock.module('$lib/state/last-dictation.svelte', () => ({
	lastDictation: { record: recordDictation, peek: () => null, clear: mock() },
}));
mock.module('$lib/state/polish-hud.svelte', () => ({
	polishHud: { begin: mock(), end: mock() },
}));

const { processRecordingPipeline } = await import('./pipeline.js');
type TironianApp = import('$lib/app/app').TironianApp;

const app = {
	settings: { get: () => false },
	recordings: {
		create(fields: Record<string, unknown>) {
			return { ...fields, id: 'recording-1' as RecordingId };
		},
		// The row as the pipeline reads it back after the transcript was patched in.
		get: (id: string) => ({
			id,
			transcript: 'raw words',
			polishedTranscript: null,
		}),
		update: mock(async () => Ok(undefined)),
	},
	snippets: { all: [] },
} as unknown as TironianApp;

function start(): Promise<void> {
	return processRecordingPipeline(app, {
		audioBlobId: generateBlobId(),
		durationMs: 100,
		deliverySource: 'recording',
	});
}

afterEach(() => {
	transcriptionDelaysMs = [];
	transcripts = [];
	failingRuns = [];
	transcribeCalls = 0;
	delivered.length = 0;
	withheld = false;
	outcomeKind = 'none';
	markFailed.mockClear();
	record.mockClear();
	recordDictation.mockClear();
});

/**
 * The regression this file exists for. `onSpeechEnd` is typed
 * `(blob: Blob) => void` and called without an await, so an async handler
 * returns a floating promise and the next utterance can start behind it. A
 * long sentence takes longer to transcribe than a short one, so unordered runs
 * deliver the short one first.
 */
test('a slow run still delivers before the fast run started after it', async () => {
	transcriptionDelaysMs = [30, 0];
	transcripts = ['the long sentence', 'scratch that'];

	const first = start();
	const second = start();
	await Promise.all([first, second]);

	expect(delivered).toEqual(['the long sentence', 'scratch that']);
});

/**
 * The destructive half. `lastDelivery` holds the grapheme count an undo
 * backspaces, so a run that delivers out of order also leaves the undo aimed
 * at text that is no longer the last thing at the cursor.
 */
test('the last delivery held is the one that delivered last', async () => {
	transcriptionDelaysMs = [30, 0];
	transcripts = ['the long sentence', 'the short one'];

	await Promise.all([start(), start()]);

	expect(record).toHaveBeenCalledTimes(2);
	expect(record.mock.calls[0]?.[0]).toMatchObject({
		text: 'the long sentence',
	});
	expect(record.mock.calls[1]?.[0]).toMatchObject({ text: 'the short one' });
});

/**
 * A rejected run must leave the queue usable. Holding the rejection in the
 * tail would reject every later utterance without running it, so one bad
 * transcription would end the dictation session.
 */
test('a failed run does not poison the queue behind it', async () => {
	transcriptionDelaysMs = [10, 0];
	transcripts = ['never delivered', 'delivered anyway'];
	failingRuns = [0];

	const first = start();
	const second = start();

	await expect(first).rejects.toThrow('transcription 0 failed');
	await second;

	expect(delivered).toEqual(['delivered anyway']);
});

/**
 * The repeat commands refuse while the outcome reads in-flight, so a throw
 * that skipped every terminal marker would lock them until the next dictation.
 * The throw still reaches the caller.
 */
test('a run that throws mid-dictation marks the lifecycle failed and still rejects', async () => {
	failingRuns = [0];

	await expect(start()).rejects.toThrow('transcription 0 failed');

	expect(markFailed).toHaveBeenCalledTimes(1);
	expect(markFailed.mock.calls[0]?.[0]).toMatchObject({
		tier: 'transcription',
	});
	expect(outcomeKind).toBe('failed');
});

test('a file import that throws leaves the dictation lifecycle alone', async () => {
	failingRuns = [0];
	// An in-flight outcome, so only the delivery source can explain the skip.
	outcomeKind = 'transcribing';

	await expect(
		processRecordingPipeline(app, {
			audioBlobId: generateBlobId(),
			durationMs: 100,
			deliverySource: 'import',
		}),
	).rejects.toThrow('transcription 0 failed');

	expect(markFailed).not.toHaveBeenCalled();
});

/**
 * "Paste last dictation" repeats what shipped, so the pipeline hands the
 * holder the delivered text with the row's transcript fields as they stand
 * when it ships. The row is read back, not taken from the one `create`
 * returned, which still has an empty transcript.
 */
test('a delivered dictation is held with the row it came from', async () => {
	transcripts = ['hello there'];

	await start();

	expect(recordDictation).toHaveBeenCalledTimes(1);
	expect(recordDictation).toHaveBeenCalledWith({
		text: 'hello there',
		recordingId: 'recording-1',
		transcript: 'raw words',
		polishedTranscript: null,
	});
});

/** The guard promised withheld text lives only in history. */
test('a withheld dictation is not held', async () => {
	transcripts = ['a secret'];
	withheld = true;

	await start();

	expect(recordDictation).not.toHaveBeenCalled();
});
