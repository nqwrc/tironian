/**
 * Whether "scratch that" may send its backspaces where focus is now.
 *
 * `simulate_backspaces` posts up to 2000 real Backspace keystrokes into
 * whatever holds focus at that moment. The undo record says how many
 * characters were delivered; it never said where. Dictate into an editor,
 * switch to a chat window, say "scratch that", and the keystrokes eat the chat
 * window's text instead. Nothing in the app checked.
 *
 * So the decision is fail-closed, against the house convention the
 * secure-field guard sets, and the asymmetry is the reason. The guard
 * withholds new text on an affirmative `secure` verdict and passes on
 * `unknown`, because a guard that randomly refuses delivery kills trust and
 * the cost of a wrong refusal is an annoyance. Here a wrong allow destroys
 * text the person already has, and the cost of a wrong refusal is the sentence
 * the 2000-character cap already tells them: select it and delete it. When the
 * two answers are "mildly annoying" and "unrecoverable", the probe does not
 * get the benefit of the doubt.
 *
 * The price is named rather than hidden: `get_foreground_context` reports an
 * app id on Windows and on macOS (identity needs no Accessibility grant), and
 * `unknown` everywhere else, so undo stops working on Linux. That is the
 * honest answer there, because on Linux Tironian genuinely cannot tell where
 * the backspaces will land.
 */
export type UndoTargetDecision = 'allow' | 'moved' | 'unknown';

export function decideUndoTarget({
	deliveredTo,
	focusedNow,
}: {
	/** The app that held the delivery, from the probe taken at paste time. */
	deliveredTo: string | null;
	/** The app in front now, from a fresh probe. */
	focusedNow: string | null;
}): UndoTargetDecision {
	if (deliveredTo === null || focusedNow === null) return 'unknown';
	return deliveredTo === focusedNow ? 'allow' : 'moved';
}
