/**
 * The text the newest delivered dictation shipped, for "paste last dictation"
 * and "copy last dictation".
 *
 * Not `lastDelivery`: that record exists so "scratch that" can count
 * backspaces, so every delivery, an Enter, and the undo itself clear it. This
 * one answers a different question ("what did I last dictate?") and survives
 * all three. Session-only, like `lastDelivery`: nothing here is persisted.
 *
 * It also keeps the recording row's two transcript fields as they stood when
 * the dictation shipped. The row is the person's editable copy: when either
 * field no longer matches, the person has changed or removed that text in
 * Recordings, and the chord must not bring the old words back.
 *
 * Withheld dictations are never recorded (the pipeline skips them): the
 * secure-field guard promises that text lives only in history.
 */
type HeldDictation = {
	/** The text as shipped: after snippets, Polish, and a rule's recipe. */
	text: string;
	recordingId: string;
	/** The row's `transcript` when the dictation shipped. */
	transcript: string;
	/** The row's `polishedTranscript` when the dictation shipped. */
	polishedTranscript: string | null;
};

let held: HeldDictation | null = null;

export const lastDictation = {
	/** Replace whatever was held. Blank text holds nothing. */
	record(next: HeldDictation): void {
		held = next.text.trim() === '' ? null : next;
	},
	peek(): HeldDictation | null {
		return held;
	},
	clear(): void {
		held = null;
	},
};
