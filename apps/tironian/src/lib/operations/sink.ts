/**
 * The Sink seam: where a capture's text can land, expressed as one interface
 * with a handful of implementations. Each sink wraps exactly the delivery
 * behavior `delivery.ts` already had, so this is a refactor of existing
 * behavior, not new behavior. Settings never leak in here: `deliverResult`
 * resolves the settings once and hands each sink everything it needs at
 * construction, so a sink is reusable outside a settings-backed caller too.
 */
import { services } from '$lib/services';
import { type CursorSinkOptions, cursorSink } from './cursor-sink';
import type { DeliveryReach } from './delivery-reach';

/**
 * Which destination ran. Part of the delivery outcome rather than a private
 * detail, because undo has to know whether the text went through a synthetic
 * paste: the clipboard and ledger sinks never touch the keyboard.
 */
export type SinkKind = 'cursor' | 'clipboard' | 'ledger';

/**
 * What a sink did with the text. `pressedEnter` is not decoration: an Enter
 * keystroke may have submitted the text out of the input entirely, so an undo
 * cannot assume the characters are still sitting at the cursor.
 */
export type SinkOutcome = { reach: DeliveryReach; pressedEnter: boolean };

/** A pluggable delivery destination, resolved once per capture. */
export interface Sink {
	kind: SinkKind;
	deliver(text: string): Promise<SinkOutcome>;
}

/**
 * Copies to the clipboard. The clipboard IS the configured output here, so a
 * clean copy always reaches `output`. Best-effort, like today: a clipboard
 * write effectively never fails.
 */
export const clipboardSink: Sink = {
	kind: 'clipboard',
	async deliver(text) {
		await services.text.copyToClipboard(text);
		return { reach: 'output', pressedEnter: false };
	},
};

/**
 * No external side effect: the recordings row the pipeline already writes IS
 * the destination, so delivery here just means the text reached history.
 * Encodes today's "nothing configured, text reaches history" branch.
 */
export const ledgerSink: Sink = {
	kind: 'ledger',
	async deliver() {
		return { reach: 'output', pressedEnter: false };
	},
};

/**
 * The cursor sink over the live text service. The write itself, and what
 * `keepOnClipboard` and `observeField` mean, is `cursorSink`.
 */
export function createCursorSink(options: CursorSinkOptions): Sink {
	return cursorSink(services.text, options);
}
