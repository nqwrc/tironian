import { tauri } from '#platform/tauri';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { recipePicker } from '$lib/state/recipe-picker.svelte';
import { m } from '../paraglide/messages';

/**
 * Read the clipboard, then raise the in-app recipe picker over it. The user
 * picks a recipe and the picker runs it on the clipboard text. On desktop the
 * Tironian window is focused first so the palette is visible even when the
 * shortcut fired from another app; on web the picker just opens. See ADR-0099.
 */
export async function runRecipeOnClipboard() {
	const { data: clipboard, error } = await services.text.readFromClipboard();
	if (error) {
		report.error({
			title: m.recipe_clipboard_couldn_t_read_your_clipboard(),
			cause: error,
		});
		return;
	}
	const input = clipboard?.trim() ? clipboard : '';
	if (!input) {
		report.info({
			title: m.recipe_clipboard_your_clipboard_is_empty(),
			description: m.recipe_clipboard_copy_some_text_then_run_a_recipe_on(),
		});
		return;
	}
	await tauri?.mainWindow.focus();
	recipePicker.open(input);
}
