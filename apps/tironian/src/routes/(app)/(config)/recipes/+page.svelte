<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Badge } from '@tironian/ui/badge';
	import { Button } from '@tironian/ui/button';
	import { Card } from '@tironian/ui/card';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import { Input } from '@tironian/ui/input';
	import { Label } from '@tironian/ui/label';
	import * as Modal from '@tironian/ui/modal';
	import * as SectionHeader from '@tironian/ui/section-header';
	import { Switch } from '@tironian/ui/switch';
	import { Textarea } from '@tironian/ui/textarea';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { report } from '$lib/report';
	import { isBuiltinRecipeId } from '$lib/state/builtin-recipes';
	import { generateDefaultRecipe } from '$lib/state/recipes.svelte';
	import type { Recipe } from '$lib/workspace';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	let editorOpen = $state(false);
	let isEditing = $state(false);
	// The recipe being created or edited. A page-owned copy so edits never touch
	// the live row until Save.
	let working = $state<Recipe>(generateDefaultRecipe());

	function openNew() {
		working = generateDefaultRecipe();
		isEditing = false;
		editorOpen = true;
	}

	function openEdit(recipe: Recipe) {
		working = { ...recipe };
		isEditing = true;
		editorOpen = true;
	}

	async function save() {
		const name = working.name.trim();
		const instructions = working.instructions.trim();
		if (!name) {
			report.info({ title: m.recipes_name_your_recipe(), description: m.recipes_give_it_a_short_name_like_email_or() });
			return;
		}
		if (!instructions) {
			report.info({ title: m.recipes_add_an_instruction(), description: m.recipes_one_line_telling_the_ai_what_to_do() });
			return;
		}
		await app.recipes.set({ ...$state.snapshot(working), name, instructions });
		editorOpen = false;
		report.success({ title: isEditing ? 'Recipe updated' : 'Recipe created' });
	}

	function remove(recipe: Recipe) {
		confirmationDialog.open({
			title: `Delete ${recipe.name}?`,
			description: m.recipes_this_removes_the_recipe_everywhere_it_cannot(),
			confirm: { text: 'Delete', variant: 'destructive' },
			onConfirm: async () => {
				await app.recipes.delete(recipe.id);
				report.success({ title: m.recipes_recipe_deleted() });
			},
		});
	}
</script>

<svelte:head> <title>{m.nav_recipes()}</title> </svelte:head>

<main class="flex w-full flex-1 flex-col gap-2 px-4 py-4 sm:px-8 mx-auto">
	<SectionHeader.Root>
		<SectionHeader.Title
			level={1}
			class="scroll-m-20 text-4xl tracking-tight lg:text-5xl"
		>
			{m.nav_recipes()}
		</SectionHeader.Title>
		<SectionHeader.Description>
			{m.recipes_reusable_text_actions_you_run_on_demand_over()}
		</SectionHeader.Description>
	</SectionHeader.Root>

	<Card class="flex flex-col gap-4 p-6">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">{m.recipes_your_library()}</h2>
			<Button variant="outline" onclick={openNew}>
				<PlusIcon class="size-4" /> {m.recipes_new_recipe()}
			</Button>
		</div>

		<ul class="flex flex-col divide-y">
			{#each app.recipes.pickable as recipe (recipe.id)}
				{@const builtin = isBuiltinRecipeId(recipe.id)}
				<li class="flex items-start justify-between gap-4 py-3">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							{#if recipe.icon}
								<span aria-hidden="true">{recipe.icon}</span>
							{/if}
							<span class="font-medium">{recipe.name}</span>
							{#if builtin}
								<Badge variant="secondary">Built-in</Badge>
							{:else if !recipe.trusted}
								<Badge variant="outline">{m.recipes_from_a_file()}</Badge>
							{/if}
						</div>
						<p class="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
							{recipe.instructions}
						</p>
					</div>
					{#if !builtin}
						<div class="flex shrink-0 items-center gap-1">
							<Button
								tooltip={m.recipes_edit_recipe()}
								variant="ghost"
								size="icon"
								onclick={() => openEdit(recipe)}
							>
								<PencilIcon class="size-4" />
							</Button>
							<Button
								tooltip={m.recipes_delete_recipe()}
								variant="ghost"
								size="icon"
								onclick={() => remove(recipe)}
							>
								<TrashIcon class="size-4" />
							</Button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</Card>
</main>

<Modal.Root bind:open={editorOpen}>
	<Modal.Content>
		<Modal.Header>
			<Modal.Title>{isEditing ? 'Edit recipe' : 'New recipe'}</Modal.Title>
			<Modal.Description>
				{m.recipes_a_name_and_one_instruction_the_instruction_is()}
			</Modal.Description>
		</Modal.Header>
		<div class="space-y-4 p-4">
			<div class="flex gap-2">
				<div class="grid w-20 shrink-0 gap-2">
					<Label for="recipe-icon">{m.recipes_icon()}</Label>
					<Input
						id="recipe-icon"
						placeholder="🪄"
						class="text-center"
						bind:value={
							() => working.icon ?? '',
							(value) => (working = { ...working, icon: value.trim() || null })
						}
					/>
				</div>
				<div class="grid flex-1 gap-2">
					<Label for="recipe-name">{m.recipes_name()}</Label>
					<Input
						id="recipe-name"
						placeholder={m.recipes_e_g_email()}
						bind:value={working.name}
					/>
				</div>
			</div>
			<div class="grid gap-2">
				<Label for="recipe-instructions">{m.recipes_instruction()}</Label>
				<Textarea
					id="recipe-instructions"
					placeholder={m.recipes_rewrite_the_text_as_a_clear_friendly_email()}
					rows={4}
					bind:value={working.instructions}
				/>
			</div>
			<!--
				The promotion gesture for a recipe that arrived in a settings bundle.
				It sits directly under the instruction because reading the instruction
				is the whole of what is being asked: the switch means "these are my
				words now", and nothing else in the app grants that.
			-->
			{#if isEditing && !working.trusted}
				<div class="rounded-md border border-dashed p-3">
					<p class="text-sm font-medium">{m.recipes_this_recipe_came_from_a_file()}</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{m.recipes_its_instruction_runs_as_a_description_of_the()}
					</p>
					<div class="mt-3 flex items-center gap-2">
						<Switch id="recipe-trusted" bind:checked={working.trusted} />
						<Label for="recipe-trusted" class="text-sm font-normal">
							{m.recipes_i_have_read_this_instruction_and_want_it()}
						</Label>
					</div>
				</div>
			{/if}
		</div>
		<Modal.Footer>
			<Button variant="outline" onclick={() => (editorOpen = false)}>{m.recording_pill_reposition_cancel()}</Button>
			<Button onclick={save}>{isEditing ? 'Save' : 'Create'}</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
