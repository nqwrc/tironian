/**
 * Repeat-last-dictation command wiring.
 *
 * The paste chord synthesizes Ctrl/Cmd+V, so it must act on the release edge:
 * pasting on the press sends the chord's own modifiers along with the V. A
 * call with no edge (command palette, in-app button) has no release to wait
 * for and pastes at once. The copy chord writes the clipboard without keys, so
 * the press is enough.
 *
 * Key behaviors:
 * - pasteLastDictation: Pressed does nothing; Released and no edge paste
 * - copyLastDictation: Pressed copies
 * - The dispatcher drops an edge a command does not subscribe to
 *
 * `$lib`, `$app` and `#platform` have no runtime resolution under `bun test`,
 * so the registry's imports are supplied here; only the wiring is real.
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { TironianApp } from '$lib/app/app';

const pasteLastDictation = mock(async (_app: unknown) => undefined);
const copyLastDictation = mock(async (_app: unknown) => undefined);

mock.module('#platform/commands', () => ({ platformCommands: [] }));
mock.module('$app/navigation', () => ({ goto: mock() }));
mock.module('$lib/constants/urls', () => ({ dictationPath: '/dictation' }));
mock.module('$lib/operations/hands-free-instance', () => ({
	handsFreePushToTalk: { onPressed: mock(), onReleased: mock() },
}));
mock.module('$lib/operations/recipe-clipboard', () => ({
	runRecipeOnClipboard: mock(),
}));
// bun keeps one module registry per run, so this stub outlives the file: it
// carries every export other test files import from the real module.
mock.module('$lib/operations/recording', () => ({
	cancelRecording: mock(),
	isVadRecordingActive: mock(() => false),
	stopVadRecording: mock(),
	toggleManualRecording: mock(),
	toggleVadRecording: mock(),
}));
mock.module('$lib/operations/repeat-last-dictation', () => ({
	pasteLastDictation,
	copyLastDictation,
}));

const { commandRunners, dispatchCommandTrigger } = await import(
	'./commands.js'
);

const app = {} as TironianApp;

beforeEach(() => {
	pasteLastDictation.mockClear();
	copyLastDictation.mockClear();
});

test('paste: the press does not paste', () => {
	commandRunners.pasteLastDictation(app, 'Pressed');
	expect(pasteLastDictation).not.toHaveBeenCalled();
});

test('paste: the release pastes', () => {
	commandRunners.pasteLastDictation(app, 'Released');
	expect(pasteLastDictation).toHaveBeenCalledWith(app);
});

test('paste: a call with no edge pastes', () => {
	commandRunners.pasteLastDictation(app);
	expect(pasteLastDictation).toHaveBeenCalledWith(app);
});

test('paste: a chord press then release through the dispatcher pastes once', () => {
	dispatchCommandTrigger(app, 'pasteLastDictation', 'Pressed');
	dispatchCommandTrigger(app, 'pasteLastDictation', 'Released');
	expect(pasteLastDictation).toHaveBeenCalledTimes(1);
});

test('copy: the press copies', () => {
	dispatchCommandTrigger(app, 'copyLastDictation', 'Pressed');
	expect(copyLastDictation).toHaveBeenCalledWith(app);
});

test('copy: the release is not subscribed to, so it copies nothing', () => {
	dispatchCommandTrigger(app, 'copyLastDictation', 'Released');
	expect(copyLastDictation).not.toHaveBeenCalled();
});

test('copy: a call with no edge copies', () => {
	commandRunners.copyLastDictation(app);
	expect(copyLastDictation).toHaveBeenCalledWith(app);
});
