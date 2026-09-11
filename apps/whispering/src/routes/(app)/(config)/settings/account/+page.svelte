<!--
	Data: what leaves this machine, and the files that carry your setup to
	another one. It absorbed the old Import & Export and Analytics pages, which
	were the same subject split across three menu entries.
-->
<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import { Button } from '@tironian/ui/button';
	import * as Field from '@tironian/ui/field';
	import { Link } from '@tironian/ui/link';
	import { createMutation } from '@tanstack/svelte-query';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { resultMutationOptions } from 'wellcrafted/query';
	import { SettingSwitch } from '$lib/components/settings';
	import { logAnalyticsEvent } from '$lib/operations/analytics';
	import { report } from '$lib/report';
	import { getWhisperingApp } from '$lib/whispering/context';
	import { exportRecordingsMarkdown } from '$lib/whispering/recordings-markdown-export';
	import { exportSettingsBundle } from '$lib/whispering/settings-bundle-export';
	import {
		applySettingsBundle,
		availableCategoriesIn,
		parseSettingsBundle,
	} from '$lib/whispering/settings-bundle-import';
	import type {
		SettingsBundleFile,
		SettingsBundleSelection,
	} from '$lib/whispering/settings-bundle-types';
	import {
		PREFERENCE_CATEGORIES,
		PREFERENCE_CATEGORY_LABELS,
	} from '$lib/whispering/settings-categories';
	import CategoryCheckboxList from './CategoryCheckboxList.svelte';

	const app = getWhisperingApp();

	// ── Export ──────────────────────────────────────────────────────────────

	/** A selection is a set of checkbox keys; this is the one place it becomes
	 * the shape the builder and the applier both take. */
	function selectionFrom(keys: Set<string>): SettingsBundleSelection {
		return {
			preferences: PREFERENCE_CATEGORIES.filter((key) => keys.has(key)),
			snippets: keys.has('snippets'),
			recipes: keys.has('recipes'),
			appRules: keys.has('appRules'),
		};
	}

	const exportItems = $derived([
		...PREFERENCE_CATEGORIES.map((key) => ({
			key: key as string,
			label: PREFERENCE_CATEGORY_LABELS[key],
		})),
		{ key: 'snippets', label: `Snippets (${app.snippets.count})` },
		{ key: 'recipes', label: `Recipes (${app.recipes.count})` },
		{ key: 'appRules', label: `App rules (${app.appRules.count})` },
	]);

	// Everything checked to start: the common case is a full backup.
	let exportSelected = $state(
		new Set<string>([...PREFERENCE_CATEGORIES, 'snippets', 'recipes', 'appRules']),
	);

	async function handleExport() {
		const { data, error } = await exportSettingsBundle(
			app,
			selectionFrom(exportSelected),
		);
		if (error) {
			report.error({ title: m.account_export_failed(), cause: error });
			return;
		}
		if (data.categoryCount === 0) {
			report.info({
				title: m.account_nothing_to_export(),
				description: m.account_check_at_least_one_category_first(),
			});
			return;
		}
		report.success({
			title: `Exported ${data.categoryCount} ${data.categoryCount === 1 ? 'category' : 'categories'}`,
		});
	}

	// Audio is not part of the settings bundle: it is large, and it moves as its
	// own zip of Markdown files rather than inside a file meant to configure a
	// fresh install.
	const exportRecordings = createMutation(() =>
		resultMutationOptions({
			mutationKey: ['recordings', 'export'],
			mutationFn: () => exportRecordingsMarkdown(app),
		}),
	);

	// ── Import ──────────────────────────────────────────────────────────────

	let importInput = $state<HTMLInputElement>();
	let importFile = $state.raw<SettingsBundleFile | null>(null);
	let importProblem = $state<string | null>(null);
	let importSelected = $state(new Set<string>());

	const importItems = $derived.by(() => {
		if (!importFile) return [];
		const available = availableCategoriesIn(importFile);
		return [
			...available.preferences.map((key) => ({
				key: key as string,
				label: PREFERENCE_CATEGORY_LABELS[key],
			})),
			...(available.snippets
				? [
						{
							key: 'snippets',
							label: `Snippets (${importFile.snippets?.length ?? 0})`,
						},
					]
				: []),
			...(available.recipes
				? [
						{
							key: 'recipes',
							label: `Recipes (${importFile.recipes?.length ?? 0})`,
						},
					]
				: []),
			...(available.appRules
				? [
						{
							key: 'appRules',
							label: `App rules (${importFile.appRules?.length ?? 0})`,
						},
					]
				: []),
		];
	});

	async function onImportFileChosen(
		event: Event & { currentTarget: HTMLInputElement },
	) {
		const [file] = Array.from(event.currentTarget.files ?? []);
		// Reset so picking the same file again still fires `change`.
		event.currentTarget.value = '';
		if (!file) return;

		const { data, error } = parseSettingsBundle(await file.text());
		if (error) {
			importFile = null;
			importSelected = new Set();
			importProblem =
				error.type === 'NotJson'
					? 'That file is not valid JSON.'
					: error.type === 'NotAnObject'
						? 'Expected a settings file, not a bare value or list.'
						: 'This is not a settings file Tironian recognizes.';
			return;
		}

		importFile = data;
		importProblem = null;
		const available = availableCategoriesIn(data);
		importSelected = new Set<string>([
			...available.preferences,
			...(available.snippets ? ['snippets'] : []),
			...(available.recipes ? ['recipes'] : []),
			...(available.appRules ? ['appRules'] : []),
		]);
	}

	function handleApplyImport() {
		if (!importFile) return;
		const summary = applySettingsBundle(
			app,
			importFile,
			selectionFrom(importSelected),
		);
		const applied = summary.appliedPreferenceCategories.length;
		const details = [
			summary.snippets &&
				`${summary.snippets.created} snippet${summary.snippets.created === 1 ? '' : 's'} added`,
			summary.recipes &&
				`${summary.recipes.created} recipe${summary.recipes.created === 1 ? '' : 's'} added`,
			summary.appRules &&
				`${summary.appRules.created} app rule${summary.appRules.created === 1 ? '' : 's'} added`,
			summary.skippedFields > 0 &&
				`${summary.skippedFields} unreadable ${summary.skippedFields === 1 ? 'value' : 'values'} skipped`,
		].filter((part): part is string => Boolean(part));

		report.success({
			title: `Imported ${applied} settings ${applied === 1 ? 'category' : 'categories'}`,
			description: details.length > 0 ? details.join(', ') : undefined,
		});
		importFile = null;
		importSelected = new Set();
	}
</script>

<svelte:head> <title>{pageTitle(m.page_title_account_and_data())}</title> </svelte:head>

<Field.Set>
	<Field.Legend>{m.account_account_amp_data()}</Field.Legend>
	<Field.Description>
		{m.account_who_you_are_signed_in_as_what_moves()}
	</Field.Description>
	<Field.Separator />
	<Field.Group>
		<Field.Set id="data" class="scroll-mt-20">
			<Field.Legend variant="label">{m.account_export()}</Field.Legend>
			<Field.Description>
				{m.account_pick_what_to_include_then_save_it_as()}
			</Field.Description>
			<Field.Group>
				<CategoryCheckboxList
					idPrefix="export"
					items={exportItems}
					bind:selected={exportSelected}
				/>
				<div class="flex">
					<Button onclick={handleExport} disabled={exportSelected.size === 0}>
						<DownloadIcon class="size-4" />
						{m.account_export_selected()}
					</Button>
				</div>

				<Field.Field>
					<Field.Label>{m.account_export_recordings()}</Field.Label>
					<Button
						variant="outline"
						class="w-fit"
						onclick={() => {
							exportRecordings.mutate(undefined, {
								onSuccess: (data) => {
									if (data.written === 0) {
										report.info({
											title: 'Nothing to export',
											description: 'You have no recordings yet.',
										});
										return;
									}
									report.success({
										title: 'Recordings exported',
										description: `Saved ${data.written} ${data.written === 1 ? 'recording' : 'recordings'} as a zip file.`,
									});
								},
								onError: (error) => {
									// Cancelling the Save dialog is not a failure.
									if (error.name === 'SaveCancelled') return;
									report.error({
										title: 'Export failed',
										cause: error,
									});
								},
							});
						}}
						disabled={exportRecordings.isPending}
					>
						{exportRecordings.isPending
							? 'Exporting...'
							: 'Export recordings (.zip)'}
					</Button>
					<Field.Description>
						{m.account_download_every_recording_as_a_zip_of_markdown({ productName: PRODUCT_NAME })}
					</Field.Description>
				</Field.Field>
			</Field.Group>
		</Field.Set>

		<Field.Separator />

		<Field.Set id="import" class="scroll-mt-20">
			<Field.Legend variant="label">{m.account_import()}</Field.Legend>
			<Field.Description>
				{m.account_checked_preferences_replace_your_current()}
			</Field.Description>
			<Field.Group>
				<input
					bind:this={importInput}
					type="file"
					accept="application/json,.json"
					class="hidden"
					onchange={onImportFileChosen}
				/>
				<div class="flex">
					<Button variant="outline" onclick={() => importInput?.click()}>
						<UploadIcon class="size-4" />
						{m.account_choose_file()}
					</Button>
				</div>

				{#if importProblem}
					<p class="text-destructive text-sm">{importProblem}</p>
				{/if}

				{#if importFile}
					<CategoryCheckboxList
						idPrefix="import"
						items={importItems}
						bind:selected={importSelected}
					/>
					<div class="flex">
						<Button
							onclick={handleApplyImport}
							disabled={importSelected.size === 0}
						>
							{m.account_apply_import()}
						</Button>
					</div>
				{/if}
			</Field.Group>
		</Field.Set>

		<Field.Separator />

		<Field.Set id="analytics" class="scroll-mt-20">
			<Field.Legend variant="label">{m.account_analytics()}</Field.Legend>
			<Field.Description>
				{m.account_off_unless_you_turn_it_on_with_it({ productName: PRODUCT_NAME })}
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="analyticsEnabled"
					label={m.account_share_anonymized_events()}
					description={'We log simple events like "recording started" or "transcription completed". No personal data is attached to any of these events.'}
					onCheckedChange={(checked) => {
						// Log the change (only actually sends if analytics is now enabled).
						if (checked) {
							void logAnalyticsEvent(app, {
								type: 'settings_changed',
								section: 'analytics',
							});
						}
					}}
				/>

				<div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<p class="text-sm font-medium">{m.account_events_we_log()}</p>
						<ul class="text-muted-foreground space-y-1 text-sm leading-relaxed">
							<li>{m.account_button_clicks_which_features_you_use()}</li>
							<li>{m.account_completion_times_how_long_things_take()}</li>
							<li>{m.account_error_messages_when_something_fails()}</li>
						</ul>
					</div>
					<div class="space-y-1.5">
						<p class="text-sm font-medium">{m.account_never_collected()}</p>
						<ul class="text-muted-foreground space-y-1 text-sm leading-relaxed">
							<li>{m.account_your_actual_transcriptions_or_recordings()}</li>
							<li>{m.account_device_ids_or_user_identifiers()}</li>
							<li>{m.account_api_keys_or_any_personal_data()}</li>
						</ul>
					</div>
				</div>

				<Field.Description>
					{m.account_all_analytics_code_is_open_source_and()}
					<Link
						href="https://github.com/EpicenterHQ/epicenter/blob/main/apps/whispering/src/lib/services/analytics/types.ts"
						target="_blank"
						rel="noopener noreferrer"
					>
						{m.account_event_definitions()}
					</Link>,
					<Link
						href="https://github.com/search?q=repo%3AEpicenterHQ%2Fepicenter+logEvent&type=code"
						target="_blank"
						rel="noopener noreferrer"
					>
						{m.account_where_events_are_logged()}
					</Link>{m.account_and()}
					<Link
						href="https://github.com/aptabase"
						target="_blank"
						rel="noopener noreferrer"
					>
						Aptabase
					</Link>{m.account_the_service_that_receives_them()}
				</Field.Description>
			</Field.Group>
		</Field.Set>
	</Field.Group>
</Field.Set>
