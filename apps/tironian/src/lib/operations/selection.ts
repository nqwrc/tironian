import type { Result } from 'wellcrafted/result';
import type { TextError } from '#platform/text';
import { services } from '$lib/services';
import { MODIFIER_RELEASE_WAIT_MS } from '../constants/modifier-release';

/**
 * How long to wait after the synthetic copy before reading the clipboard. The OS
 * writes the selection to the clipboard asynchronously once the foreground app
 * handles the keystroke, so reading immediately can return the prior clipboard.
 * Tune if a slow app loses selections.
 */
const COPY_SETTLE_MS = 100;

/**
 * Capture the active selection in the foreground app, preserving the user's
 * clipboard. Saves the current clipboard, simulates the copy shortcut
 * (Cmd/Ctrl+C), reads the freshly copied selection, then restores the original
 * clipboard.
 *
 * Lossy by construction: the synthetic copy depends on the foreground app
 * honoring the shortcut and on OS accessibility permissions, so a null or empty
 * result means "nothing was captured," not an error. Desktop only; the browser
 * text service returns NotSupported for `simulateCopyKeystroke`.
 */
export async function captureSelection(): Promise<
	Result<string | null, TextError>
> {
	// The recipe picker's chord carries Ctrl/Cmd+Shift, and the copy below
	// synthesizes Ctrl/Cmd+C. Let the chord's modifiers lift first or the app in
	// front sees Ctrl+Shift+C. The wait is bounded and the copy goes ahead
	// either way, as it did before the wait existed: a key still held after a
	// bounded wait is the person's, and refusing here would turn a slow release
	// into a dead shortcut.
	await services.text.waitForModifiersReleased(MODIFIER_RELEASE_WAIT_MS);

	const saved = await services.text.readFromClipboard();
	if (saved.error) return saved;
	const originalClipboard = saved.data;

	const copied = await services.text.simulateCopyKeystroke();
	if (copied.error) return copied;

	await new Promise((resolve) => setTimeout(resolve, COPY_SETTLE_MS));

	const selection = await services.text.readFromClipboard();

	// Restore the user's clipboard regardless of how the read went. An empty
	// original is left as-is: an extra clipboard entry is a smaller surprise than
	// guessing how to clear it.
	if (originalClipboard !== null) {
		await services.text.copyToClipboard(originalClipboard);
	}

	return selection;
}
