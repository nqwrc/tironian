<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { Card } from '@tironian/ui/card';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import { Input } from '@tironian/ui/input';
	import { Label } from '@tironian/ui/label';
	import * as Modal from '@tironian/ui/modal';
	import * as SectionHeader from '@tironian/ui/section-header';
	import { Textarea } from '@tironian/ui/textarea';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { report } from '$lib/report';
	import { generateDefaultSnippet } from '$lib/state/snippets.svelte';
	import type { Snippet } from '$lib/workspace';
	import { exportSnippets } from '$lib/app/snippets-export';
	import { importSnippets } from '$lib/app/snippets-import';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	// A snippet delivers verbatim, so nothing downstream truncates or reflows
	// it. Bounding it here is the only place that happens.
	const MAX_REPLACEMENT_LENGTH = 2000;

	let editorOpen = $state(false);
	let isEditing = $state(false);
	// The snippet being created or edited. A page-owned copy so edits never touch
	// the live row until Save.
	let working = $state<Snippet>(generateDefaultSnippet());

	// A warning only; another row sharing this trigger never blocks saving.
	const duplicateTrigger = $derived.by(() => {
		const trigger = working.trigger.trim().toLowerCase();
		if (!trigger) return false;
		return app.snippets.all.some(
			(snippet) =>
				snippet.id !== working.id &&
				snippet.trigger.trim().toLowerCase() === trigger,
		);
	});

	function openNew() {
		working = generateDefaultSnippet();
		isEditing = false;
		editorOpen = true;
	}

	function openEdit(snippet: Snippet) {
		working = { ...snippet };
		isEditing = true;
		editorOpen = true;
	}

	async function save() {
		const trigger = working.trigger.trim();
		const replacement = working.replacement.trim();
		if (!trigger) {
			report.info({
				title: m.snippets_name_your_trigger(),
				description: m.snippets_the_phrase_you_will_say_like_my_address(),
			});
			return;
		}
		if (!replacement) {
			report.info({
				title: m.snippets_add_a_replacement(),
				description: m.snippets_the_text_to_deliver_when_you_say_the(),
			});
			return;
		}
		if (replacement.length > MAX_REPLACEMENT_LENGTH) {
			report.info({
				title: m.snippets_replacement_is_too_long(),
				description: `Keep it under ${MAX_REPLACEMENT_LENGTH} characters.`,
			});
			return;
		}
		await app.snippets.set({ ...$state.snapshot(working), trigger, replacement });
		editorOpen = false;
		report.success({ title: isEditing ? 'Snippet updated' : 'Snippet created' });
	}

	function remove(snippet: Snippet) {
		confirmationDialog.open({
			title: `Delete ${snippet.trigger}?`,
			description: m.snippets_this_removes_the_snippet_everywhere_it(),
			confirm: { text: 'Delete', variant: 'destructive' },
			onConfirm: async () => {
				await app.snippets.delete(snippet.id);
				report.success({ title: m.snippets_snippet_deleted() });
			},
		});
	}

	async function exportLibrary() {
		const { data, error } = await exportSnippets(app);
		if (error) {
			report.error({ title: m.account_export_failed(), cause: error });
			return;
		}
		if (data.written === 0) {
			report.info({ title: m.account_nothing_to_export(), description: m.snippets_add_a_snippet_first() });
			return;
		}
		report.success({ title: `Exported ${data.written} snippet${data.written === 1 ? '' : 's'}` });
	}

	let importInput = $state<HTMLInputElement>();

	async function onImportFileChosen(
		event: Event & { currentTarget: HTMLInputElement },
	) {
		const [file] = Array.from(event.currentTarget.files ?? []);
		// Reset so picking the same file again still fires `change`.
		event.currentTarget.value = '';
		if (!file) return;

		const text = await file.text();
		const { data, error } = importSnippets(app, text);
		if (error) {
			report.info({
				title: m.snippets_import_failed(),
				description:
					error.type === 'NotJson'
						? 'That file is not valid JSON.'
						: 'Expected a JSON array of snippets.',
			});
			return;
		}
		report.success({
			title: `Imported ${data.created} snippet${data.created === 1 ? '' : 's'}`,
			description:
				data.skippedDuplicate || data.rejected
					? `Skipped ${data.skippedDuplicate} duplicate trigger${data.skippedDuplicate === 1 ? '' : 's'}, rejected ${data.rejected} invalid ${data.rejected === 1 ? 'entry' : 'entries'}.`
					: undefined,
		});
	}
</script>

<svelte:head> <title>{m.nav_snippets()}</title> </svelte:head>

<main class="flex w-full flex-1 flex-col gap-2 px-4 py-4 sm:px-8 mx-auto">
	<SectionHeader.Root>
		<SectionHeader.Title
			level={1}
			class="scroll-m-20 text-4xl tracking-tight lg:text-5xl"
		>
			{m.nav_snippets()}
		</SectionHeader.Title>
		<SectionHeader.Description>
			{m.snippets_say_a_short_phrase_and_deliver_saved_text()}
		</SectionHeader.Description>
	</SectionHeader.Root>

	<Card class="flex flex-col gap-4 p-6">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">{m.recipes_your_library()}</h2>
			<div class="flex items-center gap-1">
				<Button tooltip={m.snippets_export_snippets_as_json()} variant="ghost" size="icon" onclick={exportLibrary}>
					<DownloadIcon class="size-4" />
				</Button>
				<Button
					tooltip={m.snippets_import_snippets_from_json()}
					variant="ghost"
					size="icon"
					onclick={() => importInput?.click()}
				>
					<UploadIcon class="size-4" />
				</Button>
				<Button variant="outline" onclick={openNew}>
					<PlusIcon class="size-4" /> {m.snippets_new_snippet()}
				</Button>
			</div>
		</div>
		<input
			bind:this={importInput}
			type="file"
			accept="application/json"
			class="hidden"
			onchange={onImportFileChosen}
		/>

		{#if app.snippets.count === 0}
			<p class="text-muted-foreground text-sm">
				{m.snippets_no_snippets_yet_add_one_to_speak_a()}
			</p>
		{:else}
			<ul class="flex flex-col divide-y">
				{#each app.snippets.all as snippet (snippet.id)}
					<li class="flex items-start justify-between gap-4 py-3">
						<div class="min-w-0 flex-1">
							<span class="font-medium">{snippet.trigger}</span>
							<p class="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
								{snippet.replacement}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								tooltip={m.snippets_edit_snippet()}
								variant="ghost"
								size="icon"
								onclick={() => openEdit(snippet)}
							>
								<PencilIcon class="size-4" />
							</Button>
							<Button
								tooltip={m.snippets_delete_snippet()}
								variant="ghost"
								size="icon"
								onclick={() => remove(snippet)}
							>
								<TrashIcon class="size-4" />
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</main>

<Modal.Root bind:open={editorOpen}>
	<Modal.Content>
		<Modal.Header>
			<Modal.Title>{isEditing ? 'Edit snippet' : 'New snippet'}</Modal.Title>
			<Modal.Description>
				{m.snippets_a_trigger_phrase_and_the_text_it_delivers()}
			</Modal.Description>
		</Modal.Header>
		<div class="space-y-4 p-4">
			<div class="grid gap-2">
				<Label for="snippet-trigger">{m.snippets_trigger_phrase()}</Label>
				<Input
					id="snippet-trigger"
					placeholder={m.snippets_e_g_my_address()}
					bind:value={working.trigger}
				/>
				{#if duplicateTrigger}
					<p class="text-destructive text-sm">
						{m.snippets_two_snippets_share_this_trigger_the_one()}
					</p>
				{/if}
			</div>
			<div class="grid gap-2">
				<Label for="snippet-replacement">{m.snippets_replacement()}</Label>
				<Textarea
					id="snippet-replacement"
					placeholder={m.snippets_123_main_st_springfield()}
					rows={4}
					maxlength={MAX_REPLACEMENT_LENGTH}
					bind:value={working.replacement}
				/>
				<p class="text-muted-foreground text-right text-xs">
					{working.replacement.length} / {MAX_REPLACEMENT_LENGTH}
				</p>
			</div>
		</div>
		<Modal.Footer>
			<Button variant="outline" onclick={() => (editorOpen = false)}>{m.recording_pill_reposition_cancel()}</Button>
			<Button onclick={save}>{isEditing ? 'Save' : 'Create'}</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
