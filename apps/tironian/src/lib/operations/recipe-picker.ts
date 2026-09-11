import { tauri } from '#platform/tauri';
import { captureSelection } from '$lib/operations/selection';
import { report } from '$lib/report';
import { recipePicker } from '$lib/state/recipe-picker.svelte';
import { m } from '../paraglide/messages';

/**
 * Capture the foreground app's current selection, then raise the in-app recipe
 * picker over it. The capture (a synthetic copy) runs while the other app is
 * still focused; only then do we focus Tironian's window so the palette is
 * visible. The user picks a recipe and the picker runs it on the selection.
 *
 * Desktop only (registered through the Tauri command seam). A future floating
 * picker window will drop the window-focus step. See ADR-0099.
 */
export async function openRecipePicker() {
	const { data: selection, error } = await captureSelection();
	if (error) {
		report.error({
			title: m.recipe_picker_couldn_t_read_your_selection(),
			cause: error,
		});
		return;
	}
	const input = selection?.trim() ? selection : '';
	if (!input) {
		report.info({
			title: m.recipe_picker_nothing_selected(),
			description: m.recipe_picker_select_some_text_then_open_the_recipe(),
		});
		return;
	}
	await tauri?.mainWindow.focus();
	recipePicker.open(input);
}
