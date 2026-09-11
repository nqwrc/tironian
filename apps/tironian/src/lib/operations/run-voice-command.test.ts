/**
 * Command Mode's effect runner.
 *
 * Key behaviors:
 * - `commandApplies` is the single enforcement point for the design's safety
 *   property: a matched but inapplicable command falls through and is typed
 *   as text instead of vanishing. Both commands share it: `stopListening`
 *   needs a live VAD session, `scratchThat` needs something undoable held.
 * - `scratchThat` never sends a synthetic backspace on the no-op paths
 *   (nothing held, over the undo cap, focus moved to another app, focus
 *   unidentifiable), only on a genuine held record in the app that got it.
 * - A backspace failure reports rather than throwing.
 * - `stopListening` reaches the VAD recorder exactly once.
 */
import { expect, mock, test } from 'bun:test';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';
import type { TextError } from '$lib/services/text/types';

let vadActive = false;
let canUndo = false;
const simulateBackspaces = mock(
	async (): Promise<Result<void, TextError>> => Ok(undefined),
);
/**
 * The undo record, as a stateful double rather than a canned return, because
 * whether a refusal leaves it alive is the thing under test.
 */
type Undo = { graphemes: number; appId: string | null };
let held: Undo | null = null;
const take = mock((): Undo | null => {
	const record = held;
	held = null;
	return record;
});
const peek = mock((): Undo | null => held);
/** The app in front when the undo runs. Same as the delivery's by default. */
let focusedNow: string | null = 'Code.exe';
const reportInfo = mock();
const reportError = mock();
const stopVadRecording = mock(async () => {});

mock.module('$lib/operations/recording', () => ({
	isVadRecordingActive: () => vadActive,
	stopVadRecording,
}));
mock.module('$lib/services', () => ({
	services: { text: { simulateBackspaces } },
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: {
		take,
		peek,
		canUndo: () => canUndo,
		record: mock(),
		clear: mock(),
	},
}));
mock.module('$lib/report', () => ({
	report: { info: reportInfo, error: reportError },
}));
mock.module('$lib/operations/foreground-probe', () => ({
	probeForegroundContext: async () => ({
		focusedField: 'unknown',
		appId: focusedNow,
	}),
}));
// The real decision, under the alias `bun test` cannot resolve. Faking it would
// make the two refusal tests assert their own stub.
const undoTarget = await import('./undo-target.js');
mock.module('$lib/operations/undo-target', () => undoTarget);

const { commandApplies, runVoiceCommand } = await import(
	'./run-voice-command.js'
);

const app = {} as unknown as TironianApp;

test("commandApplies('stopListening') follows whether VAD is live", () => {
	vadActive = false;
	expect(commandApplies('stopListening')).toBe(false);
	vadActive = true;
	expect(commandApplies('stopListening')).toBe(true);
	vadActive = false;
});

test("commandApplies('scratchThat') follows whether something undoable is held, regardless of VAD state", () => {
	canUndo = false;
	vadActive = false;
	expect(commandApplies('scratchThat')).toBe(false);
	vadActive = true;
	expect(commandApplies('scratchThat')).toBe(false);
	vadActive = false;

	canUndo = true;
	expect(commandApplies('scratchThat')).toBe(true);
	canUndo = false;
});

test('scratchThat with nothing held sends no backspaces and reports an info notice', async () => {
	held = null;
	await runVoiceCommand(app, 'scratchThat');
	expect(simulateBackspaces).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenLastCalledWith({
		title: 'Nothing to undo',
		description:
			'There is no dictation at your cursor to remove. Only text Tironian pasted at the cursor can be taken back.',
	});
});

test('scratchThat over the cap sends no backspaces and reports an info notice', async () => {
	held = { graphemes: 2001, appId: 'Code.exe' };
	await runVoiceCommand(app, 'scratchThat');
	expect(simulateBackspaces).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenLastCalledWith({
		title: 'That dictation is too long to undo',
		description:
			'Undo is capped at 2000 characters, so nothing was removed. Select the text and delete it instead.',
	});
});

test('scratchThat with a held record sends exactly one backspace call for its graphemes', async () => {
	held = { graphemes: 12, appId: 'Code.exe' };
	await runVoiceCommand(app, 'scratchThat');
	expect(simulateBackspaces).toHaveBeenCalledTimes(1);
	expect(simulateBackspaces).toHaveBeenLastCalledWith(12);
});

/**
 * The destructive case this guard exists for. Dictate into an editor, switch to
 * a chat window, say "scratch that": without the check, up to 2000 real
 * Backspace keystrokes land in the chat window and delete what was typed there.
 */
test('scratchThat refuses when focus has moved to another app', async () => {
	simulateBackspaces.mockClear();
	held = { graphemes: 12, appId: 'Code.exe' };
	focusedNow = 'slack.exe';

	await runVoiceCommand(app, 'scratchThat');

	expect(simulateBackspaces).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenLastCalledWith({
		title: 'That dictation is in another window',
		description:
			'Undo only removes text from the app it was dictated into. Switch back to it, or select the text and delete it.',
	});
	focusedNow = 'Code.exe';
});

/**
 * Fail-closed, unlike the secure-field guard: an undo that cannot name its
 * target sends nothing. The cost is that undo does not work where the platform
 * reports no app id, which is Linux.
 */
test('scratchThat refuses when the app in front cannot be identified', async () => {
	simulateBackspaces.mockClear();
	held = { graphemes: 12, appId: 'Code.exe' };
	focusedNow = null;

	await runVoiceCommand(app, 'scratchThat');

	expect(simulateBackspaces).not.toHaveBeenCalled();
	expect(reportInfo).toHaveBeenLastCalledWith({
		title: "Couldn't tell which window to undo in",
		description:
			'Tironian could not confirm the app the last dictation went to, so it sent no backspaces. Select the text and delete it instead.',
	});
	focusedNow = 'Code.exe';
});

/**
 * The refusal copy tells the person to switch back to the app and say it again,
 * so that has to work. It only does because a refusal leaves the record alive,
 * and leaving it alive is only safe because the target check runs every time: a
 * third window would not match either.
 */
test('a refused undo still runs after switching back to the app', async () => {
	simulateBackspaces.mockClear();
	held = { graphemes: 12, appId: 'Code.exe' };
	focusedNow = 'slack.exe';
	await runVoiceCommand(app, 'scratchThat');
	expect(simulateBackspaces).not.toHaveBeenCalled();

	focusedNow = 'Code.exe';
	await runVoiceCommand(app, 'scratchThat');

	expect(simulateBackspaces).toHaveBeenCalledTimes(1);
	expect(simulateBackspaces).toHaveBeenLastCalledWith(12);
});

test('a failing simulateBackspaces reports an error notice and does not throw', async () => {
	held = { graphemes: 5, appId: 'Code.exe' };
	const cause = { name: 'SimulateKeystroke' } as unknown as TextError;
	simulateBackspaces.mockImplementationOnce(async () => Err(cause));
	await runVoiceCommand(app, 'scratchThat');
	expect(reportError).toHaveBeenLastCalledWith({
		title: "Couldn't undo the last dictation",
		cause,
	});
});

test("runVoiceCommand(app, 'stopListening') reaches the VAD recorder exactly once", async () => {
	stopVadRecording.mockClear();
	await runVoiceCommand(app, 'stopListening');
	expect(stopVadRecording).toHaveBeenCalledTimes(1);
	expect(stopVadRecording).toHaveBeenLastCalledWith(app);
});
