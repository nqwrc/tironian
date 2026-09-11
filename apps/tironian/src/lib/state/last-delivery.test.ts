import { beforeEach, expect, test } from 'bun:test';
import { lastDelivery } from './last-delivery.svelte';

beforeEach(() => lastDelivery.clear());

test('a clean cursor paste is undoable, counted in graphemes', () => {
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toEqual({ graphemes: 5, appId: 'Code.exe' });
});

test('an emoji and a combining mark each count as one backspace', () => {
	// One backspace deletes one grapheme cluster, so a UTF-16 length would
	// overshoot and eat the words before it.
	lastDelivery.record({
		text: '👨‍👩‍👧',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toEqual({ graphemes: 1, appId: 'Code.exe' });

	// Written as e + U+0301 on purpose: a combining mark, not the single
	// precomposed character, or the test proves nothing.
	lastDelivery.record({
		text: 'é',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toEqual({ graphemes: 1, appId: 'Code.exe' });
});

test('nothing that skipped the keyboard is undoable', () => {
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'clipboard',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toBeNull();

	lastDelivery.record({
		text: 'hello',
		sinkKind: 'ledger',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toBeNull();

	// A cursor write that could not paste left the text on the clipboard.
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'clipboard',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toBeNull();
});

test('the record is consumed once', () => {
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toEqual({ graphemes: 5, appId: 'Code.exe' });
	expect(lastDelivery.take()).toBeNull();
});

test('nothing held reads as nothing to undo', () => {
	expect(lastDelivery.take()).toBeNull();
});

test('an Enter keystroke after the paste makes it unreachable', () => {
	// The Enter toggle exists to submit in chat apps, so the text may already
	// have left the input. Backspaces would eat whatever is in the box next.
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: true,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toBeNull();
});

test('the non-undoable path clears the record too', () => {
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'clipboard',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.take()).toBeNull();
	// Nothing recorded in between, so a still-held record would show up here.
	expect(lastDelivery.take()).toBeNull();
});

test('canUndo peeks without consuming the record', () => {
	expect(lastDelivery.canUndo()).toBe(false);

	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	// Asking twice must not itself be the thing that clears the record.
	expect(lastDelivery.canUndo()).toBe(true);
	expect(lastDelivery.canUndo()).toBe(true);
	expect(lastDelivery.take()).toEqual({ graphemes: 5, appId: 'Code.exe' });
	expect(lastDelivery.canUndo()).toBe(false);
});

test('an empty transcript is not undoable', () => {
	// A zero-grapheme "undo" would send no backspaces, report success, and tell
	// the person nothing: its own silent swallow.
	lastDelivery.record({
		text: '',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'Code.exe',
	});
	expect(lastDelivery.canUndo()).toBe(false);
	expect(lastDelivery.take()).toBeNull();
});

/**
 * The app the delivery was written into rides along, so "scratch that" can
 * refuse when focus has moved somewhere else by the time the undo runs.
 * Whether it may run is decided in `operations/undo-target.test.ts`; here the
 * id only has to survive the round trip, because a record that drops it makes
 * every undo unidentifiable and therefore refused.
 */
test('the app the text was written into rides along with the count', () => {
	lastDelivery.record({
		text: 'hello',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
		appId: 'slack.exe',
	});

	expect(lastDelivery.take()).toEqual({ graphemes: 5, appId: 'slack.exe' });
});
