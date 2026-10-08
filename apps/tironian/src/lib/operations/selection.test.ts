/**
 * Selection capture.
 *
 * Key behaviors:
 * - The chord's modifiers get a bounded wait to lift before the synthetic
 *   copy, so the app in front sees Ctrl/Cmd+C and not Ctrl/Cmd+Shift+C
 * - The capture goes ahead when they never lift: the wait narrows nothing
 * - The user's clipboard is restored after the capture
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import { Ok, type Result } from 'wellcrafted/result';
import type { TextError } from '$lib/services/text/types';

const order: string[] = [];
let lifted = true;
let clipboard: string | null = 'what the person had copied';
const waitForModifiersReleased = mock(async (_timeoutMs: number) => {
	order.push('wait');
	return lifted;
});
const readFromClipboard = mock(
	async (): Promise<Result<string | null, TextError>> => {
		order.push('read');
		return Ok(clipboard);
	},
);
const copyToClipboard = mock(
	async (_text: string): Promise<Result<void, TextError>> => {
		order.push('restore');
		return Ok(undefined);
	},
);
const simulateCopyKeystroke = mock(
	async (): Promise<Result<void, TextError>> => {
		order.push('copy');
		clipboard = 'the selected words';
		return Ok(undefined);
	},
);

mock.module('$lib/services', () => ({
	services: {
		text: {
			waitForModifiersReleased,
			readFromClipboard,
			copyToClipboard,
			simulateCopyKeystroke,
		},
	},
}));

const { captureSelection } = await import('./selection.js');

beforeEach(() => {
	order.length = 0;
	lifted = true;
	clipboard = 'what the person had copied';
	for (const fn of [
		waitForModifiersReleased,
		readFromClipboard,
		copyToClipboard,
		simulateCopyKeystroke,
	]) {
		fn.mockClear();
	}
});

test('waits for the chord to lift before it sends the copy keystroke', async () => {
	await captureSelection();

	expect(waitForModifiersReleased).toHaveBeenCalledWith(600);
	expect(order.indexOf('wait')).toBeGreaterThanOrEqual(0);
	expect(order.indexOf('wait')).toBeLessThan(order.indexOf('copy'));
});

test('still captures when the modifiers never lift', async () => {
	lifted = false;

	const { data, error } = await captureSelection();

	expect(error).toBeNull();
	expect(simulateCopyKeystroke).toHaveBeenCalledTimes(1);
	expect(data).toBe('the selected words');
});

test('restores the clipboard the person had', async () => {
	await captureSelection();

	expect(copyToClipboard).toHaveBeenCalledWith('what the person had copied');
});
