/**
 * The cursor sink's write: whether it asks the host to observe the paste.
 *
 * The text service is an argument, so no module is mocked and the result does
 * not depend on test file order or on registry isolation.
 */
import { expect, mock, test } from 'bun:test';
import { Ok, type Result } from 'wellcrafted/result';
import type { TextError, WriteTextOutcome } from '../services/text/types';
import { cursorSink } from './cursor-sink';

function fakeText() {
	return {
		writeToCursor: mock(
			async (
				_text: string,
				_keepOnClipboard: boolean,
				_observe: boolean,
			): Promise<Result<WriteTextOutcome, TextError>> => Ok('pasted'),
		),
		copyToClipboard: mock(
			async (_text: string): Promise<Result<void, TextError>> => Ok(undefined),
		),
		simulateEnterKeystroke: mock(
			async (): Promise<Result<void, TextError>> => Ok(undefined),
		),
	};
}

test('observing is off unless asked', async () => {
	const text = fakeText();
	await cursorSink(text, { keepOnClipboard: false, pressEnter: false }).deliver(
		'ciao a tutti voi',
	);
	expect(text.writeToCursor).toHaveBeenCalledWith(
		'ciao a tutti voi',
		false,
		false,
	);
});

test('a cursor paste can ask the host to observe', async () => {
	const text = fakeText();
	await cursorSink(text, {
		keepOnClipboard: true,
		pressEnter: false,
		observeField: true,
	}).deliver('x y z');
	expect(text.writeToCursor).toHaveBeenCalledWith('x y z', true, true);
});

test('an Enter after the paste never observes: the submit takes the text away', async () => {
	const text = fakeText();
	const outcome = await cursorSink(text, {
		keepOnClipboard: false,
		pressEnter: true,
		observeField: true,
	}).deliver('x y z');
	expect(text.writeToCursor).toHaveBeenCalledWith('x y z', false, false);
	expect(text.simulateEnterKeystroke).toHaveBeenCalledTimes(1);
	expect(outcome).toEqual({ reach: 'output', pressedEnter: true });
});
