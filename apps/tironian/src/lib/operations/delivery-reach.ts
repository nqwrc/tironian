/**
 * How far the text reached, relative to the user's configured output. Delivery is
 * a reduced-reach axis, not a pass/fail: the transcript is always saved to
 * history, so a reduced reach is a recoverable success, never a dictation failure
 * (ADR-0039).
 *
 * - `output`: landed where configured — pasted at the cursor, or copied to the
 *   clipboard / saved to history when that is the configured sink. The clean case.
 * - `clipboard`: a cursor write was requested but could not paste (no
 *   Accessibility grant, or the paste failed), so the transcript was left on the
 *   clipboard. Usable, but not where the user asked.
 *
 * There is no `history`-only reach: a cursor write that cannot paste always leaves
 * the transcript on the clipboard (see `write_text` in src-tauri and ADR-0040),
 * so the text is never stranded somewhere the user would not look.
 */
export type DeliveryReach = 'output' | 'clipboard';

import type { SinkKind } from './sink';

export type DeliveryOutcome = {
	reach: DeliveryReach;
	sinkKind: SinkKind;
	pressedEnter: boolean;
	/**
	 * True when the secure-field guard withheld a cursor or clipboard delivery
	 * because a password field had focus at paste time. The text was routed to
	 * the ledger sink instead (still in history, nothing on the clipboard), so
	 * `reach` reads `output` for the substituted sink; this flag is what tells
	 * feedback the configured output was deliberately refused. A refusal
	 * announced to the user is not the accidental stranding ADR-0040 abolished.
	 */
	withheld: boolean;
	/**
	 * The app that held focus when the text was written, from the probe delivery
	 * already takes for the secure-field guard. Null when the platform, the
	 * grant, or the probe could not say. "Scratch that" holds onto it so it can
	 * refuse rather than backspace into a window the dictation never reached.
	 */
	deliveredToAppId: string | null;
};
