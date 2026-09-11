import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { isErr, Ok, type Result } from 'wellcrafted/result';
import type { TironianApp } from '$lib/app/app';
import {
	buildRecipeSystemPrompt,
	wrapRecipeInput,
} from '$lib/operations/build-system-prompt';
import { completeWithGlobalDefault } from '$lib/operations/completion';
import type { Recipe } from '$lib/workspace';
import { m } from '../paraglide/messages';

export const RunRecipeError = defineErrors({
	InvalidInput: ({ message }: { message: string }) => ({ message }),
	Empty: ({ message }: { message: string }) => ({ message }),
	Failed: ({ message }: { message: string }) => ({ message }),
});
export type RunRecipeError = InferErrors<typeof RunRecipeError>;

/**
 * Run one Recipe over `input` and return its take: a single AI call whose
 * directive is `recipe.instructions` and whose content is `input`. Text in,
 * text out, nothing else: no pre/post replacements, no `{{input}}` template, no
 * per-Recipe model. Polish has already run upstream, so `input` is the polished
 * text and this never re-does correction.
 *
 * A recipe the person did not write commands nothing: `recipe.trusted` picks
 * the demoted scaffold, where the instructions are content in their own block
 * rather than the directive. Nothing else about the run changes.
 *
 * The system prompt is a fixed scaffold wrapping `recipe.instructions`, plus the
 * Dictionary block (via `buildRecipeSystemPrompt`, with `dictionary` read at use
 * per ADR 0012), and `input` goes out inside the boundary that scaffold names.
 * The scaffold is what makes a Recipe safe to point at text the user did not
 * write: the automatic per-app-rule path pastes the result at the cursor, and the
 * clipboard path runs over whatever was copied. Provider and model come from the
 * single global `completion.*` default (via `completeWithGlobalDefault`), not
 * from the Recipe.
 *
 * Pure execution: no workspace writes, no persistence, no toasts. The picker is
 * the caller; it owns delivery and any history bookkeeping.
 */
export async function runRecipe(
	app: TironianApp,
	{
		input,
		recipe,
		signal,
	}: {
		input: string;
		recipe: Recipe;
		/**
		 * Cancels the in-flight AI call. The auto-run path passes the pill
		 * HUD's signal so "ship raw" also skips a rule's recipe; the caller
		 * decides what an abort means (the pipeline treats it as "ship the
		 * un-reshaped text", a clean outcome rather than a failure).
		 */
		signal?: AbortSignal;
	},
): Promise<Result<string, RunRecipeError>> {
	if (!input.trim()) {
		return RunRecipeError.InvalidInput({
			message: m.run_recipe_empty_input_please_enter_some_text_to_run(),
		});
	}
	if (!recipe.instructions.trim()) {
		return RunRecipeError.Empty({
			message: m.run_recipe_this_recipe_has_no_instructions_add_an(),
		});
	}

	const result = await completeWithGlobalDefault(app, {
		systemPrompt: buildRecipeSystemPrompt(
			recipe.instructions,
			app.settings.get('dictionary'),
			{ trusted: recipe.trusted },
		),
		userPrompt: wrapRecipeInput(input),
		signal,
	});

	if (isErr(result)) {
		return RunRecipeError.Failed({
			message: extractErrorMessage(result.error),
		});
	}
	return Ok(result.data);
}
