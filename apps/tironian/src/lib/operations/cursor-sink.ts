/**
 * The cursor sink over an explicit text service. Its own module, with no
 * runtime `$lib` import, so its test mocks no module: under plain `bun test`
 * every file shares one module registry, and a `$lib/services` fake
 * registered by one file is what another file's subject may import.
 */
import type { TextService } from '$lib/services/text/types';
import type { Sink } from './sink';

/** The three text-service calls a cursor delivery makes. */
export type CursorText = Pick<
	TextService,
	'writeToCursor' | 'copyToClipboard' | 'simulateEnterKeystroke'
>;

export type CursorSinkOptions = {
	keepOnClipboard: boolean;
	pressEnter: boolean;
	/**
	 * Ask the host to record where this paste lands, for correction learning
	 * (ADR-0271). Never together with Enter: a submit takes the text out of the
	 * field, so there would be nothing to observe.
	 */
	observeField?: boolean;
};

/**
 * Writes at the cursor via a synthetic paste, with the clipboard as staging
 * and fallback.
 *
 * `keepOnClipboard` tells `write_text` what the clipboard should hold
 * afterward (it owns the staging delivery used to pre-copy): when clipboard
 * output is on it leaves the text there; when off it borrows and restores the
 * user's clipboard (full-fidelity on macOS, see `write_text`'s docstring in
 * src-tauri). `write_text` decides from the Accessibility grant whether it can
 * paste and reports where the text landed: `pasted` at the cursor (clean), or
 * `leftOnClipboard` when it could not paste.
 */
export function cursorSink(
	textService: CursorText,
	{ keepOnClipboard, pressEnter, observeField = false }: CursorSinkOptions,
): Sink {
	return {
		kind: 'cursor',
		async deliver(text) {
			const { data: writeOutcome, error: writeError } =
				await textService.writeToCursor(
					text,
					keepOnClipboard,
					observeField && !pressEnter,
				);

			if (writeError) {
				// The write failed outright (rare). Ensure the text is at least on
				// the clipboard, and report the reduced reach.
				await textService.copyToClipboard(text);
				return { reach: 'clipboard', pressedEnter: false };
			}

			let pressedEnter = false;
			if (writeOutcome === 'pasted' && pressEnter) {
				// The Enter keystroke is a nicety on top of a successful write, and a
				// failure here still does not change where the text landed. It does
				// change whether an undo can reach it, so the attempt is what counts:
				// a submit may already have taken the text out of the input.
				await textService.simulateEnterKeystroke();
				pressedEnter = true;
			}

			// A clean `pasted` reached the configured output; a `leftOnClipboard`
			// fallback is a reduced (but recoverable) reach (see DeliveryReach and
			// ADR-0039/0040).
			return {
				reach: writeOutcome === 'pasted' ? 'output' : 'clipboard',
				pressedEnter,
			};
		},
	};
}
