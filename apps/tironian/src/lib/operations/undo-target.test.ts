/**
 * Undo Target Tests
 *
 * "Scratch that" posts real Backspace keystrokes into whatever holds focus at
 * that moment. The undo record said how many characters were delivered; it
 * never said where, so dictating into an editor, switching to a chat window,
 * and saying "scratch that" ate the chat window's text.
 *
 * Key behavior: the undo runs only when the app in front is provably the app
 * that got the text. Fail-closed, against the fail-open convention
 * `decideSecureFieldGuard` sets, because the two costs are not comparable: a
 * wrong refusal here is one sentence of copy, a wrong allow is text the person
 * already had.
 */
import { expect, test } from 'bun:test';
import { decideUndoTarget } from './undo-target';

test('the same app allows the undo', () => {
	expect(
		decideUndoTarget({ deliveredTo: 'Code.exe', focusedNow: 'Code.exe' }),
	).toBe('allow');
});

/**
 * The destructive case, and the one nothing checked. The backspaces would have
 * gone into Slack, deleting whatever the person had typed there.
 */
test('a different app refuses', () => {
	expect(
		decideUndoTarget({ deliveredTo: 'Code.exe', focusedNow: 'slack.exe' }),
	).toBe('moved');
});

/**
 * `get_foreground_context` reports an app id on Windows and macOS and
 * `unknown` everywhere else, so either side can be null. Fail-closed answers
 * both the same way: an undo that cannot name its target does not fire.
 */
test('an unknown app on either side refuses', () => {
	expect(decideUndoTarget({ deliveredTo: null, focusedNow: 'Code.exe' })).toBe(
		'unknown',
	);
	expect(decideUndoTarget({ deliveredTo: 'Code.exe', focusedNow: null })).toBe(
		'unknown',
	);
	expect(decideUndoTarget({ deliveredTo: null, focusedNow: null })).toBe(
		'unknown',
	);
});
