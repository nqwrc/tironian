<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import { Badge } from '@tironian/ui/badge';
	import { Button } from '@tironian/ui/button';
	import { Card } from '@tironian/ui/card';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import { Input } from '@tironian/ui/input';
	import { Label } from '@tironian/ui/label';
	import * as Modal from '@tironian/ui/modal';
	import * as SectionHeader from '@tironian/ui/section-header';
	import * as Select from '@tironian/ui/select';
	import { Switch } from '@tironian/ui/switch';
	import { Textarea } from '@tironian/ui/textarea';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import type { AnyTaggedError } from 'wellcrafted/error';
	import { os } from '#platform/os';
	import { report } from '$lib/report';
	import { services } from '$lib/services';
	import { generateDefaultAppRule } from '$lib/state/app-rules.svelte';
	import type { AppRule } from '$lib/workspace';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	let editorOpen = $state(false);
	let isEditing = $state(false);
	// The rule being created or edited. A page-owned mutable copy so edits
	// never touch the live row until Save.
	type EditableAppRule = { -readonly [K in keyof AppRule]: AppRule[K] };
	let working = $state<EditableAppRule>(generateDefaultAppRule());

	// This device's identifier field: the one "Use current app" can fill and
	// the one shown first. The other platform's field stays editable so a rule
	// authored here still matches on the other machine (ADR-0233).
	const thisPlatformIsMac = os.isApple;

	// A duplicate identifier blocks saving: matching is exact, so two enabled
	// rules naming the same app would race on row id, and "first" should never
	// decide a real match.
	const duplicateIdentifier = $derived.by(() => {
		const exe = working.matchWindowsExe?.trim().toLowerCase() || null;
		const bundle = working.matchMacosBundleId?.trim().toLowerCase() || null;
		return app.appRules.all.some(
			(rule) =>
				rule.id !== working.id &&
				((exe !== null && rule.matchWindowsExe?.trim().toLowerCase() === exe) ||
					(bundle !== null &&
						rule.matchMacosBundleId?.trim().toLowerCase() === bundle)),
		);
	});

	const recipeName = $derived.by(() => {
		if (working.recipeId === null) return 'None (Polish only)';
		const recipe = app.recipes.pickable.find(
			(candidate) => candidate.id === working.recipeId,
		);
		return recipe?.name ?? 'Missing recipe';
	});

	function openNew() {
		cancelCapture();
		working = generateDefaultAppRule();
		isEditing = false;
		editorOpen = true;
	}

	function openEdit(rule: AppRule) {
		cancelCapture();
		working = { ...rule };
		isEditing = true;
		editorOpen = true;
	}

	// "Use current app": a short countdown so the person can focus the target
	// window, then one foreground probe fills this platform's identifier and,
	// when the name is still blank, the display name. The countdown belongs to
	// one editing session: closing the editor or opening another rule cancels
	// it, so a stale timer can never write into a rule it was not started for.
	let captureCountdown = $state(0);
	let captureTimer: ReturnType<typeof setInterval> | undefined;

	function cancelCapture() {
		clearInterval(captureTimer);
		captureTimer = undefined;
		captureCountdown = 0;
	}

	$effect(() => {
		if (!editorOpen) cancelCapture();
		return cancelCapture;
	});

	function useCurrentApp() {
		if (captureTimer !== undefined) return;
		captureCountdown = 3;
		captureTimer = setInterval(async () => {
			captureCountdown -= 1;
			if (captureCountdown > 0) return;
			cancelCapture();
			const { appId, appName } = await services.context
				.getForegroundContext()
				.catch(() => ({ appId: null, appName: null }));
			if (appId === null) {
				report.info({
					title: m.apps_couldn_t_identify_the_app(),
					description:
						m.apps_the_system_refused_to_name_the_foreground_app(),
				});
				return;
			}
			if (thisPlatformIsMac) {
				working.matchMacosBundleId = appId;
			} else {
				working.matchWindowsExe = appId;
			}
			if (!working.name.trim() && appName) working.name = appName;
		}, 1000);
	}

	async function save() {
		const name = working.name.trim();
		const exe = working.matchWindowsExe?.trim().toLowerCase() || null;
		const bundle = working.matchMacosBundleId?.trim() || null;
		if (!name) {
			report.info({
				title: m.apps_name_the_rule(),
				description: m.apps_what_you_call_the_app_like_terminal(),
			});
			return;
		}
		if (exe === null && bundle === null) {
			report.info({
				title: m.apps_identify_the_app(),
				description:
					m.apps_add_at_least_one_identifier_a_windows_exe(),
			});
			return;
		}
		if (duplicateIdentifier) {
			report.info({
				title: m.apps_another_rule_already_matches_this_app(),
				description: m.apps_edit_that_rule_instead_of_adding_a_second(),
			});
			return;
		}
		try {
			app.appRules.set({
				...$state.snapshot(working),
				name,
				matchWindowsExe: exe,
				matchMacosBundleId: bundle,
				polishInstructions: working.polishInstructions?.trim() || null,
			});
		} catch (cause) {
			// The row can vanish under the editor (deleted on another device,
			// synced in mid-edit); the store then refuses the update. The store
			// only ever throws the table's own tagged error.
			report.error({
				title: m.apps_couldn_t_save_the_rule(),
				cause: cause as AnyTaggedError,
			});
			return;
		}
		editorOpen = false;
		report.success({ title: isEditing ? 'Rule updated' : 'Rule created' });
	}

	function remove(rule: AppRule) {
		confirmationDialog.open({
			title: `Delete ${rule.name}?`,
			description: m.apps_this_removes_the_rule_everywhere_it_cannot_be(),
			confirm: { text: 'Delete', variant: 'destructive' },
			onConfirm: async () => {
				await app.appRules.delete(rule.id);
				report.success({ title: m.apps_rule_deleted() });
			},
		});
	}

	function describeMatch(rule: AppRule): string {
		return [rule.matchWindowsExe, rule.matchMacosBundleId]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<svelte:head> <title>{pageTitle(m.page_title_app_rules())}</title> </svelte:head>

<main class="flex w-full flex-1 flex-col gap-2">
	<SectionHeader.Root>
		<SectionHeader.Title level={1}>{m.page_title_app_rules()}</SectionHeader.Title>
		<SectionHeader.Description>
			{m.apps_shape_dictation_per_app_when_you_start_dictating()}
		</SectionHeader.Description>
	</SectionHeader.Root>

	<Card class="flex flex-col gap-4 p-6">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">{m.apps_your_rules()}</h2>
			<Button variant="outline" onclick={openNew}>
				<PlusIcon class="size-4" /> {m.apps_new_rule()}
			</Button>
		</div>

		{#if app.appRules.count === 0}
			<p class="text-muted-foreground text-sm">
				{m.apps_no_rules_yet_add_one_to_give_an()}
			</p>
		{:else}
			<ul class="flex flex-col divide-y">
				{#each app.appRules.all as rule (rule.id)}
					<li class="flex items-start justify-between gap-4 py-3">
						<div class="min-w-0 flex-1">
							<span class="font-medium" class:opacity-50={!rule.enabled}>
								{rule.name}
							</span>
							{#if !rule.trusted}
								<Badge variant="outline" class="ml-2">{m.recipes_from_a_file()}</Badge>
							{/if}
							<p class="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
								{describeMatch(rule)}
								{#if !rule.enabled}
									· disabled
								{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								tooltip={m.apps_edit_rule()}
								variant="ghost"
								size="icon"
								onclick={() => openEdit(rule)}
							>
								<PencilIcon class="size-4" />
							</Button>
							<Button
								tooltip={m.apps_delete_rule()}
								variant="ghost"
								size="icon"
								onclick={() => remove(rule)}
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
			<Modal.Title>{isEditing ? 'Edit rule' : 'New rule'}</Modal.Title>
			<Modal.Description>
				{m.apps_matched_against_the_app_in_front_when_you()}
			</Modal.Description>
		</Modal.Header>
		<div class="space-y-4 p-4">
			<div class="grid gap-2">
				<Label for="rule-name">{m.recipes_name()}</Label>
				<Input id="rule-name" placeholder={m.apps_e_g_terminal()} bind:value={working.name} />
			</div>
			<div class="grid gap-2">
				<div class="flex items-center justify-between">
					<Label for={thisPlatformIsMac ? 'rule-bundle' : 'rule-exe'}>
						{thisPlatformIsMac ? 'macOS bundle id' : 'Windows app (exe name)'}
					</Label>
					<Button variant="ghost" size="sm" onclick={useCurrentApp}>
						<CrosshairIcon class="size-4" />
						{captureCountdown > 0
							? `Switch to the app… ${captureCountdown}`
							: 'Use current app'}
					</Button>
				</div>
				{#if thisPlatformIsMac}
					<Input
						id="rule-bundle"
						placeholder="com.googlecode.iterm2"
						bind:value={
							() => working.matchMacosBundleId ?? '',
							(value) => (working.matchMacosBundleId = value || null)
						}
					/>
				{:else}
					<Input
						id="rule-exe"
						placeholder="wt.exe"
						bind:value={
							() => working.matchWindowsExe ?? '',
							(value) => (working.matchWindowsExe = value || null)
						}
					/>
				{/if}
				{#if duplicateIdentifier}
					<p class="text-destructive text-sm">
						{m.apps_another_rule_already_matches_this_app_2()}
					</p>
				{/if}
			</div>
			<div class="grid gap-2">
				<Label for={thisPlatformIsMac ? 'rule-exe' : 'rule-bundle'}>
					{thisPlatformIsMac
						? 'Windows app (exe name, optional)'
						: 'macOS bundle id (optional)'}
				</Label>
				{#if thisPlatformIsMac}
					<Input
						id="rule-exe"
						placeholder="wt.exe"
						bind:value={
							() => working.matchWindowsExe ?? '',
							(value) => (working.matchWindowsExe = value || null)
						}
					/>
				{:else}
					<Input
						id="rule-bundle"
						placeholder="com.googlecode.iterm2"
						bind:value={
							() => working.matchMacosBundleId ?? '',
							(value) => (working.matchMacosBundleId = value || null)
						}
					/>
				{/if}
				<p class="text-muted-foreground text-xs">
					{m.apps_one_rule_can_carry_both_identifiers_so_it()}
				</p>
			</div>
			<div class="grid gap-2">
				<Label for="rule-polish">{m.apps_polish_directive_optional()}</Label>
				<Textarea
					id="rule-polish"
					placeholder={m.apps_e_g_no_punctuation_all_lowercase_keep_technical()}
					rows={3}
					bind:value={
						() => working.polishInstructions ?? '',
						(value) => (working.polishInstructions = value || null)
					}
				/>
				<p class="text-muted-foreground text-xs">
					{m.apps_replaces_your_global_polish_directive_while()}
				</p>
			</div>
			<div class="grid gap-2">
				<Label for="rule-recipe">{m.apps_auto_run_recipe_optional()}</Label>
				<Select.Root
					type="single"
					bind:value={
						() => working.recipeId ?? 'none',
						(value) => (working.recipeId = value === 'none' ? null : value)
					}
				>
					<Select.Trigger id="rule-recipe" class="w-full">
						{recipeName}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="none" label={m.apps_none_polish_only()} />
						{#each app.recipes.pickable as recipe (recipe.id)}
							<Select.Item value={recipe.id} label={recipe.name} />
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">
					{m.apps_runs_after_polish_on_every_dictation_into_this()}
				</p>
			</div>
			<!--
				The promotion gesture for a rule that arrived in a settings bundle,
				directly under the directive it is about. Separate from Enabled on
				purpose: running the rule and vouching for its words are two
				different answers, and a bundle grants neither.
			-->
			{#if isEditing && !working.trusted}
				<div class="rounded-md border border-dashed p-3">
					<p class="text-sm font-medium">{m.apps_this_rule_came_from_a_file()}</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{m.apps_its_polish_directive_runs_as_a_description_of()}
					</p>
					<div class="mt-3 flex items-center gap-2">
						<Switch id="rule-trusted" bind:checked={working.trusted} />
						<Label for="rule-trusted" class="text-sm font-normal">
							{m.apps_i_have_read_this_directive_and_want_it()}
						</Label>
					</div>
				</div>
			{/if}
			<div class="flex items-center justify-between">
				<Label for="rule-enabled">{m.apps_enabled()}</Label>
				<Switch id="rule-enabled" bind:checked={working.enabled} />
			</div>
		</div>
		<Modal.Footer>
			<Button variant="outline" onclick={() => (editorOpen = false)}>{m.recording_pill_reposition_cancel()}</Button>
			<Button onclick={save}>{isEditing ? 'Save' : 'Create'}</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
