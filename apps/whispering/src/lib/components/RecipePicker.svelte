<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Badge } from '@tironian/ui/badge';
	import * as Command from '@tironian/ui/command';
	import * as Modal from '@tironian/ui/modal';
	import { deliverRecipeResult } from '$lib/operations/delivery';
	import { runRecipe } from '$lib/operations/run-recipe';
	import { playSoundIfEnabled } from '$lib/operations/sound';
	import { report } from '$lib/report';
	import { isBuiltinRecipeId } from '$lib/state/builtin-recipes';
	import { recipePicker } from '$lib/state/recipe-picker.svelte';
	import type { Recipe } from '$lib/workspace';
	import { getWhisperingApp } from '$lib/whispering/context';

	const app = getWhisperingApp();

	/**
	 * The in-app Recipe picker: a command palette the `openRecipePicker` /
	 * `runRecipeOnClipboard` shortcuts raise over the captured text. Mounted once
	 * in the app layout; visibility is driven entirely by the `recipePicker` rune.
	 * Picking a recipe runs it on the captured source and delivers the take. See
	 * ADR-0099.
	 */

	async function run(recipe: Recipe) {
		const input = recipePicker.source;
		recipePicker.close();
		const loading = report.loading({
			title: `Running ${recipe.name}...`,
			description: m.recipe_picker_reshaping_your_text_with_ai(),
		});
		const { data, error } = await runRecipe(app, { input, recipe });
		if (error) {
			loading.reject({
				title: `Couldn't run ${recipe.name}`,
				description: error.message,
				cause: error,
			});
			return;
		}
		await playSoundIfEnabled(app, 'recipeComplete');
		const { notice } = await deliverRecipeResult(app, {
			text: data,
			recordingId: null,
		});
		loading.resolve(notice);
	}
</script>

<Modal.Root
	bind:open={
		() => recipePicker.isOpen, (open) => { if (!open) recipePicker.close(); }
	}
>
	<Modal.Content class="overflow-hidden p-0">
		<Modal.Title class="sr-only">{m.recipe_picker_run_a_recipe_2()}</Modal.Title>
		<Modal.Description class="sr-only">
			{m.recipe_picker_pick_a_recipe_to_run_on_your_captured()}
		</Modal.Description>
		<Command.Root loop>
			<Command.Input placeholder={m.recipe_picker_run_a_recipe()} />
			<Command.List>
				<Command.Empty>{m.recipe_picker_no_recipes_found()}</Command.Empty>
				<Command.Group>
					{#each app.recipes.pickable as recipe (recipe.id)}
						<Command.Item value={recipe.name} onSelect={() => run(recipe)}>
							{#if recipe.icon}
								<span aria-hidden="true">{recipe.icon}</span>
							{/if}
							<span class="flex-1 truncate">{recipe.name}</span>
							{#if isBuiltinRecipeId(recipe.id)}
								<Badge variant="secondary">Built-in</Badge>
							{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Modal.Content>
</Modal.Root>
