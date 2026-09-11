/**
 * Transcription Delivery Tests
 *
 * Locks the settings-to-sink routing for transcript delivery. The clipboard-only
 * Dictate path is easy to regress because no type changes when cursor-off
 * delivery falls back to history instead of copying externally.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const delivered: string[] = [];
const settingsValues = new Map<string, boolean>();
const clearDelivery = mock();

mock.module('$app/navigation', () => ({
	goto: mock(),
}));

// Reached by alias like `$lib/operations/sink` below, so it needs the same
// explicit registration. The real `deliverToSink` runs in this file, so this
// mock is where the "every delivery clears the held undo" behavior is
// actually proven, not just mirrored.
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: {
		clear: clearDelivery,
		take: mock(),
		record: mock(),
		canUndo: mock(),
	},
}));

mock.module('$lib/constants/urls', () => ({
	DICTATION_RECORDINGS_PATHNAME: '/apps/dictation/recordings',
}));

// One probe at paste time, two readers: the secure-field guard takes the
// focused-field verdict, and the undo record takes the app id so "scratch that"
// can refuse rather than backspace into a window the dictation never reached.
// Each test sets what the probe reports.
let focusedField: 'secure' | 'notSecure' | 'unknown' = 'unknown';
let foregroundAppId: string | null = null;
mock.module('$lib/services', () => ({
	services: {
		context: {
			getForegroundContext: async () => ({
				appId: foregroundAppId,
				appName: null,
				focusedField,
			}),
		},
	},
}));

mock.module('$lib/operations/sink', () => ({
	clipboardSink: {
		kind: 'clipboard',
		async deliver(text: string) {
			delivered.push(`clipboard:${text}`);
			return { reach: 'output', pressedEnter: false };
		},
	},
	ledgerSink: {
		kind: 'ledger',
		async deliver(text: string) {
			delivered.push(`ledger:${text}`);
			return { reach: 'output', pressedEnter: false };
		},
	},
	createCursorSink({
		keepOnClipboard,
		pressEnter,
	}: {
		keepOnClipboard: boolean;
		pressEnter: boolean;
	}) {
		return {
			kind: 'cursor',
			async deliver(text: string) {
				delivered.push(`cursor:${text}:${keepOnClipboard}:${pressEnter}`);
				return { reach: 'output', pressedEnter: pressEnter };
			},
		};
	},
}));

const { deliverTranscriptionResult } = await import(
	'../src/lib/operations/delivery'
);
type TironianApp = import('../src/lib/app/app').TironianApp;

const app = {
	settings: {
		get(key: string) {
			return settingsValues.get(key) ?? false;
		},
	},
} as unknown as TironianApp;

describe('transcription delivery', () => {
	beforeEach(() => {
		delivered.length = 0;
		settingsValues.clear();
		settingsValues.set('outputTranscriptionClipboard', false);
		settingsValues.set('outputTranscriptionCursor', false);
		settingsValues.set('outputTranscriptionEnter', false);
		focusedField = 'unknown';
		foregroundAppId = null;
		clearDelivery.mockClear();
	});

	test('cursor off and clipboard on copies to the clipboard sink', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome).toEqual({
			reach: 'output',
			sinkKind: 'clipboard',
			pressedEnter: false,
			withheld: false,
			deliveredToAppId: null,
		});
		expect(delivered).toEqual(['clipboard:hello']);
	});

	/**
	 * The undo record's half of the paste-time probe. "Scratch that" posts real
	 * Backspace keystrokes wherever focus is when it runs, so it has to be able
	 * to compare that against the window the text actually went into.
	 *
	 * The guard is on here because it is on by default and because the probe is
	 * skipped when nothing reads it: a clipboard delivery with the guard off has
	 * neither reader, since only a cursor write is undoable.
	 */
	test('the outcome names the app the text was written into', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);
		settingsValues.set('secureFieldGuardEnabled', true);
		foregroundAppId = 'Code.exe';

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome.deliveredToAppId).toBe('Code.exe');
	});

	test('a delivery nothing could undo does not pay for the probe', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);
		settingsValues.set('secureFieldGuardEnabled', false);
		foregroundAppId = 'Code.exe';

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome.deliveredToAppId).toBeNull();
	});

	test('cursor off and clipboard off delivers to history only', async () => {
		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome).toEqual({
			reach: 'output',
			sinkKind: 'ledger',
			pressedEnter: false,
			withheld: false,
			// A ledger delivery writes to history, where no keystroke can go
			// wrong, so it never takes the probe.
			deliveredToAppId: null,
		});
		expect(delivered).toEqual(['ledger:hello']);
	});

	test('a secure field at paste time withholds to the ledger sink', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);
		settingsValues.set('secureFieldGuardEnabled', true);
		focusedField = 'secure';

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome).toEqual({
			reach: 'output',
			sinkKind: 'ledger',
			pressedEnter: false,
			withheld: true,
			// Nothing was written, so no app is named: an undo acting on this
			// would backspace into a window that never got the text.
			deliveredToAppId: null,
		});
		// Nothing reached the clipboard: the withhold is total, not a fallback.
		expect(delivered).toEqual(['ledger:hello']);
	});

	test('an unknown verdict fails open and delivers normally', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);
		settingsValues.set('secureFieldGuardEnabled', true);
		focusedField = 'unknown';

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome.withheld).toBe(false);
		expect(delivered).toEqual(['clipboard:hello']);
	});

	test('a disabled guard never probes the focused field away from delivery', async () => {
		settingsValues.set('outputTranscriptionClipboard', true);
		focusedField = 'secure';

		const result = await deliverTranscriptionResult(app, { text: 'hello' });

		expect(result.outcome.withheld).toBe(false);
		expect(delivered).toEqual(['clipboard:hello']);
	});

	test('every delivery clears whatever undo was held before it', async () => {
		// Any sink, any settings: a delivery this file did not itself hold for
		// undo must not leave a stale record for "scratch that" to backspace into.
		await deliverTranscriptionResult(app, { text: 'hello' });
		expect(clearDelivery).toHaveBeenCalledTimes(1);
	});
});
