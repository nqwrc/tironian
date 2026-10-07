/**
 * Paste last dictation and copy last dictation.
 *
 * Key behaviors:
 * - Paste writes the held text at the cursor and presses no Enter, after the
 *   chord's modifiers lift; if they do not lift it copies and does not paste
 * - Both refuse while a dictation is in flight
 * - The held text is out of reach once its recording row is gone or edited
 * - The secure-field guard is re-run at the moment of the action
 * - Paste replaces the undo record; copy leaves it alone
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Ok, type Result } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';
import { TextError, type WriteTextOutcome } from '../services/text/types';

type Held = {
	text: string;
	recordingId: string;
	transcript: string;
	polishedTranscript: string | null;
};
type Row = {
	id: string;
	transcript: string;
	polishedTranscript: string | null;
};

const TEXT = 'Ho aggiornato il ticket su Jira.';
const order: string[] = [];

let held: Held | null = null;
const clearDictation = mock(() => {
	held = null;
});
let outcomeKind: string = 'none';
let focused: {
	focusedField: 'secure' | 'notSecure' | 'unknown';
	appId: string | null;
} = { focusedField: 'notSecure', appId: 'code.exe' };
const probe = mock(async () => focused);
let writeOutcome: WriteTextOutcome = 'pasted';
let modifiersUp = true;
const waitForModifiersReleased = mock(async (_timeoutMs: number) => {
	order.push('wait');
	return modifiersUp;
});
const writeToCursor = mock(
	async (
		_text: string,
		_keep: boolean,
	): Promise<Result<WriteTextOutcome, TextError>> => {
		order.push('write');
		return Ok(writeOutcome);
	},
);
let copyFails = false;
const copyToClipboard = mock(
	async (_text: string): Promise<Result<void, TextError>> => {
		order.push('copy');
		return copyFails
			? TextError.ClipboardWrite({ cause: new Error('busy') })
			: Ok(undefined);
	},
);
const simulateEnterKeystroke = mock(async () => Ok(undefined));
const deliveryClear = mock();
const deliveryRecord = mock();
const reportInfo = mock();
const reportError = mock();
const osNotify = mock();

mock.module('$lib/state/last-dictation.svelte', () => ({
	lastDictation: { peek: () => held, clear: clearDictation, record: mock() },
}));
mock.module('$lib/state/dictation-lifecycle.svelte', () => ({
	dictationLifecycle: {
		get current() {
			return { capture: { kind: 'idle' }, outcome: { kind: outcomeKind } };
		},
	},
}));
mock.module('$lib/operations/foreground-probe', () => ({
	probeForegroundContext: probe,
}));
mock.module('$lib/services', () => ({
	services: {
		text: {
			waitForModifiersReleased,
			writeToCursor,
			copyToClipboard,
			simulateEnterKeystroke,
		},
	},
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: { clear: deliveryClear, record: deliveryRecord },
}));
mock.module('$lib/report', () => ({
	report: { info: reportInfo, error: reportError },
}));
mock.module('#platform/os-notify', () => ({ osNotify }));
// The real decision: faking it would make the guard tests assert their own stub.
const guard = await import('./secure-field-guard.js');
mock.module('$lib/operations/secure-field-guard', () => guard);
// The sink is stubbed down to its write: bun keeps one module registry per run,
// so the real sink could stay bound to another file's `$lib/services` mock.
// `createSink` records how the operation configures it.
const createSink = mock(
	(_options: { keepOnClipboard: boolean; pressEnter: boolean }) => ({
		kind: 'cursor' as const,
		async deliver(text: string) {
			const { data } = await writeToCursor(text, _options.keepOnClipboard);
			return {
				reach: data === 'pasted' ? ('output' as const) : ('clipboard' as const),
				pressedEnter: false,
			};
		},
	}),
);
mock.module('$lib/operations/sink', () => ({ createCursorSink: createSink }));

const { pasteLastDictation, copyLastDictation } = await import(
	'./repeat-last-dictation.js'
);

let guardOn = true;
let rows = new Map<string, Row>();
const app = {
	settings: {
		get: (key: string) =>
			key === 'secureFieldGuardEnabled'
				? guardOn
				: key === 'outputTranscriptionClipboard'
					? false
					: undefined,
	},
	recordings: { get: (id: string) => rows.get(id) },
} as unknown as TironianApp;

const mocks = [
	probe,
	waitForModifiersReleased,
	writeToCursor,
	copyToClipboard,
	simulateEnterKeystroke,
	deliveryClear,
	deliveryRecord,
	reportInfo,
	reportError,
	osNotify,
	clearDictation,
	createSink,
];

/** A global chord usually fires with the Tironian window hidden. */
function windowHasFocus(focus: boolean) {
	(globalThis as { document?: unknown }).document = {
		hasFocus: () => focus,
		cookie: '',
	};
}

beforeEach(() => {
	held = {
		text: TEXT,
		recordingId: 'r1',
		transcript: 'ho aggiornato il ticket su jira',
		polishedTranscript: TEXT,
	};
	rows = new Map([
		[
			'r1',
			{
				id: 'r1',
				transcript: 'ho aggiornato il ticket su jira',
				polishedTranscript: TEXT,
			},
		],
	]);
	focused = { focusedField: 'notSecure', appId: 'code.exe' };
	writeOutcome = 'pasted';
	modifiersUp = true;
	copyFails = false;
	guardOn = true;
	outcomeKind = 'none';
	order.length = 0;
	windowHasFocus(true);
	for (const fn of mocks) fn.mockClear();
});

afterEach(() => {
	(globalThis as { document?: unknown }).document = undefined;
});

test('paste: writes the held text at the cursor, never presses Enter', async () => {
	await pasteLastDictation(app);
	expect(writeToCursor).toHaveBeenCalledWith(TEXT, false);
	expect(createSink).toHaveBeenCalledWith({
		keepOnClipboard: false,
		pressEnter: false,
	});
	expect(simulateEnterKeystroke).not.toHaveBeenCalled();
});

test('paste: waits up to 600 ms for the chord to lift, before it writes', async () => {
	await pasteLastDictation(app);
	expect(waitForModifiersReleased).toHaveBeenCalledWith(600);
	expect(order).toEqual(['wait', 'write']);
});

test('paste: modifiers still held means no paste, the text goes to the clipboard and the person is told', async () => {
	modifiersUp = false;
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(copyToClipboard).toHaveBeenCalledWith(TEXT);
	expect(deliveryClear).not.toHaveBeenCalled();
	expect(deliveryRecord).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenCalledTimes(1);
});

test('paste: modifiers still held and the clipboard write fails is an error, not a silent loss', async () => {
	modifiersUp = false;
	copyFails = true;
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(reportError).toHaveBeenCalledTimes(1);
});

test('paste: a password field withholds before it waits or copies anything', async () => {
	focused = { focusedField: 'secure', appId: 'keepass.exe' };
	modifiersUp = false;
	await pasteLastDictation(app);
	expect(waitForModifiersReleased).not.toHaveBeenCalled();
	expect(copyToClipboard).not.toHaveBeenCalled();
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(deliveryClear).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenCalledTimes(1);
});

test('paste: replaces the undo record with this paste, aimed at the app probed now', async () => {
	await pasteLastDictation(app);
	expect(deliveryClear).toHaveBeenCalledTimes(1);
	expect(deliveryRecord).toHaveBeenCalledWith({
		text: TEXT,
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'code.exe',
	});
});

test('paste: a clipboard fallback is recorded as reduced reach and announced', async () => {
	writeOutcome = 'leftOnClipboard';
	await pasteLastDictation(app);
	expect(deliveryRecord.mock.calls[0]?.[0]).toMatchObject({
		reach: 'clipboard',
	});
	expect(reportInfo).toHaveBeenCalledTimes(1);
});

test('paste: nothing held announces and writes nothing', async () => {
	held = null;
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(deliveryClear).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenCalledTimes(1);
});

test('paste: a deleted recording takes the held text with it', async () => {
	rows = new Map();
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(clearDictation).toHaveBeenCalledTimes(1);
});

test('paste: an edited transcript takes the held text out of reach', async () => {
	rows.set('r1', {
		id: 'r1',
		transcript: 'ho corretto il ticket su jira',
		polishedTranscript: TEXT,
	});
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(clearDictation).toHaveBeenCalledTimes(1);
});

test('paste: an edited polished transcript takes the held text out of reach', async () => {
	rows.set('r1', {
		id: 'r1',
		transcript: 'ho aggiornato il ticket su jira',
		polishedTranscript: 'Ho aggiornato il ticket.',
	});
	await pasteLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(clearDictation).toHaveBeenCalledTimes(1);
});

test('paste: the guard switched off lets an affirmative secure verdict through', async () => {
	guardOn = false;
	focused = { focusedField: 'secure', appId: 'keepass.exe' };
	await pasteLastDictation(app);
	expect(writeToCursor).toHaveBeenCalledTimes(1);
});

test.each([
	'transcribing',
	'polishing',
])('paste and copy: refuse while a dictation is %s', async (kind) => {
	outcomeKind = kind;
	await pasteLastDictation(app);
	await copyLastDictation(app);
	expect(writeToCursor).not.toHaveBeenCalled();
	expect(copyToClipboard).not.toHaveBeenCalled();
	expect(probe).not.toHaveBeenCalled();
	expect(deliveryClear).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenCalledTimes(2);
	expect(reportInfo.mock.calls[0]?.[0]).toMatchObject({
		title: 'A dictation is still being delivered',
	});
});

test('paste: a finished delivery that persists on the pill does not block', async () => {
	outcomeKind = 'delivered';
	await pasteLastDictation(app);
	expect(writeToCursor).toHaveBeenCalledTimes(1);
});

test('copy: copies and leaves the undo record alone', async () => {
	await copyLastDictation(app);
	expect(copyToClipboard).toHaveBeenCalledWith(TEXT);
	expect(deliveryClear).not.toHaveBeenCalled();
	expect(deliveryRecord).not.toHaveBeenCalled();
	expect(waitForModifiersReleased).not.toHaveBeenCalled();
});

test('copy: success reaches the OS notification centre when the window is hidden', async () => {
	windowHasFocus(false);
	await copyLastDictation(app);
	expect(reportInfo).toHaveBeenCalledTimes(1);
	expect(osNotify).toHaveBeenCalledTimes(1);
	expect(osNotify.mock.calls[0]?.[0]).toBe('Last dictation copied');
});

test('copy: success stays a toast when the window has focus', async () => {
	await copyLastDictation(app);
	expect(reportInfo).toHaveBeenCalledTimes(1);
	expect(osNotify).not.toHaveBeenCalled();
});

test('copy: a failed clipboard write is an error', async () => {
	copyFails = true;
	await copyLastDictation(app);
	expect(reportError).toHaveBeenCalledTimes(1);
});

test('copy: blocked next to a password field while the guard is on', async () => {
	focused = { focusedField: 'secure', appId: 'keepass.exe' };
	await copyLastDictation(app);
	expect(copyToClipboard).not.toHaveBeenCalled();
});

test('copy: with the guard off it does not pay for a probe', async () => {
	guardOn = false;
	await copyLastDictation(app);
	expect(probe).not.toHaveBeenCalled();
	expect(copyToClipboard).toHaveBeenCalledTimes(1);
});

test('copy: nothing held announces and copies nothing', async () => {
	held = null;
	await copyLastDictation(app);
	expect(copyToClipboard).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenCalledTimes(1);
});
