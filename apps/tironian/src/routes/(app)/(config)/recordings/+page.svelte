<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { CopyButton } from '@tironian/ui/copy-button';
	import * as Empty from '@tironian/ui/empty';
	import { Input } from '@tironian/ui/input';
	import { Label } from '@tironian/ui/label';
	import * as Modal from '@tironian/ui/modal';
	import { Textarea } from '@tironian/ui/textarea';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import MicIcon from '@lucide/svelte/icons/mic';
	import StartTranscriptionIcon from '@lucide/svelte/icons/play';
	import RetryTranscriptionIcon from '@lucide/svelte/icons/repeat';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { createMutation } from '@tanstack/svelte-query';
	import { SvelteSet } from 'svelte/reactivity';
	import { PATHS } from '$lib/services/fs-paths';
	import { report } from '$lib/report';
	import { tauri } from '#platform/tauri';
	import { deleteRecordingsWithConfirmation } from '$lib/operations/delete-recordings';
	import type { Recording } from '$lib/state/recordings.svelte';
	import { createCopyFn } from '$lib/utils/createCopyFn';
	import { getTironianApp, getTironianQueries } from '$lib/app/context';
	import RecordingRow from './RecordingRow.svelte';
	import {
		formatDictated,
		groupByDay,
		matchesQuery,
		totalDurationMs,
	} from './recording-groups';

	/**
	 * The recordings list of the Vivavoce shell (4c): rows grouped by day, dense
	 * like a tool, with per-row actions on hover and the detail modal one click
	 * away. Bulk work (transcribe, copy with a template, delete) sits behind
	 * Select, so the list stays quiet until it is asked for.
	 */
	const app = getTironianApp();
	const queries = getTironianQueries();

	const transcribeRecordings = createMutation(
		() => queries.transcription.transcribeRecordings.options,
	);

	let query = $state('');
	let selecting = $state(false);
	const selected = new SvelteSet<Recording['id']>();

	const all = $derived(app.recordings.sorted);
	const visible = $derived(all.filter((row) => matchesQuery(row, query)));
	const groups = $derived(groupByDay(visible, new Date()));
	const selectedRecordings = $derived(all.filter((row) => selected.has(row.id)));

	function displayTranscript(recording: Recording): string {
		return recording.polishedTranscript ?? recording.transcript;
	}

	function dayLabel(group: (typeof groups)[number]): string {
		if (group.relative === 'today') return m.recordings_today();
		if (group.relative === 'yesterday') return m.recordings_yesterday();
		return group.date.toLocaleDateString([], {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		});
	}

	function toggle(id: Recording['id']) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
	}

	let template = $state('{{recordedAt}} {{transcript}}');
	let delimiter = $state('\n\n');
	let isDialogOpen = $state(false);

	const joinedTranscriptionsText = $derived.by(() =>
		selectedRecordings
			.filter((recording) => displayTranscript(recording) !== '')
			.map((recording) =>
				template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
					if (key === 'transcript') return displayTranscript(recording);
					if (key in recording) {
						const value = recording[key as keyof Recording];
						return typeof value === 'string' ? value : '';
					}
					return '';
				}),
			)
			.join(delimiter),
	);

	function transcribeSelected() {
		const loading = report.loading({
			title: 'Transcribing recordings...',
			description: 'This may take a while.',
		});
		transcribeRecordings.mutate(selectedRecordings, {
			onSuccess: ({ oks, errs }) => {
				const historyUnconfirmedTexts = oks.flatMap(({ data }) =>
					data.history.error === null ? [] : [data.text],
				);
				const historyWarningCount = historyUnconfirmedTexts.length;
				const copyUnsavedAction =
					historyWarningCount === 0
						? undefined
						: {
								label: 'Copy unsaved transcripts',
								onClick: () =>
									createCopyFn('unsaved transcripts')(
										historyUnconfirmedTexts.join('\n\n'),
									),
							};
				if (errs.length === 0) {
					const count = oks.length;
					loading.resolve({
						title: `Transcribed ${count} recording${count === 1 ? '' : 's'}`,
						description:
							historyWarningCount === 0
								? `Your ${count} recording${count === 1 ? ' has' : 's have'} been transcribed successfully.`
								: `Recording history may be incomplete for ${historyWarningCount} transcription${historyWarningCount === 1 ? '' : 's'}.`,
						action: copyUnsavedAction,
					});
					return;
				}

				// transcribeAndPersist attempts to mark each failed row so history
				// can surface its message plus a retry. So the bulk toast only
				// summarizes, and forwards the first real failure as the cause so
				// More details stays a genuine provider error rather than a
				// synthesized one. Dedupe the messages so a batch that failed the
				// same way (every row missing the API key) reads as one line.
				const [firstFailure] = errs;
				if (!firstFailure) return;
				const failureSummary = [
					...new Set(errs.map(({ error }) => error.message)),
				].join('\n');

				if (oks.length === 0) {
					loading.reject({
						cause: firstFailure.error,
						title: `Failed to transcribe ${errs.length} recording${errs.length === 1 ? '' : 's'}`,
						description: failureSummary,
					});
					return;
				}

				loading.reject({
					cause: firstFailure.error,
					title: `Transcribed ${oks.length} of ${oks.length + errs.length} recordings`,
					description: `${oks.length} succeeded, ${errs.length} failed${historyWarningCount === 0 ? '' : `, ${historyWarningCount} may not have been saved to history`}:\n${failureSummary}`,
					action: copyUnsavedAction,
				});
			},
		});
	}

	async function openBlobsFolder() {
		if (!tauri) return;
		const { error } = await tauri.opener.openPath(await PATHS.DB.BLOBS());
		if (error)
			report.error({ title: m.recordings_failed_to_open_folder(), cause: error });
	}
</script>

<svelte:head> <title>{m.recordings_all_recordings()}</title> </svelte:head>

<main class="flex w-full flex-1 flex-col">
	<header
		class="flex flex-wrap items-center gap-3.5 border-b border-border/60 px-6 pt-5 pb-3.5"
	>
		<h1 class="text-lg font-semibold">{m.nav_recordings()}</h1>
		<span class="font-mono text-[11px] text-muted-foreground tabular-nums">
			{all.length} · {formatDictated(totalDurationMs(all))}
			{m.recordings_dictated()}
		</span>
		<span class="flex-1"></span>
		{#if tauri}
			<Button
				tooltip={m.recordings_open_audio_storage_folder()}
				aria-label={m.recordings_open_audio_storage_folder()}
				variant="ghost"
				size="icon-sm"
				class="text-muted-foreground"
				onclick={openBlobsFolder}
			>
				<ExternalLinkIcon class="size-4" />
			</Button>
		{/if}
		<Button
			variant={selecting ? 'secondary' : 'ghost'}
			size="sm"
			class="h-8"
			onclick={() => (selecting ? stopSelecting() : (selecting = true))}
		>
			{selecting ? m.recordings_done() : m.recordings_select()}
		</Button>
		<div class="relative w-56">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				placeholder={m.recordings_search_in_text()}
				type="search"
				class="h-8 pl-8 text-sm"
				bind:value={query}
			/>
		</div>
	</header>

	{#if selecting}
		<div
			class="flex items-center gap-2 border-b border-border/60 px-6 py-2 text-sm"
		>
			<span class="text-muted-foreground tabular-nums">
				{m.recordings_n_selected({ count: selectedRecordings.length })}
			</span>
			<Button
				variant="ghost"
				size="sm"
				class="h-7"
				onclick={() => visible.forEach((row) => selected.add(row.id))}
			>
				{m.recordings_select_all()}
			</Button>
			<span class="flex-1"></span>
			{#if selectedRecordings.length > 0}
				<Button
					tooltip={m.recordings_transcribe_selected_recordings()}
					aria-label={m.recordings_transcribe_selected_recordings()}
					variant="outline"
					size="icon-sm"
					disabled={transcribeRecordings.isPending}
					onclick={transcribeSelected}
				>
					{#if transcribeRecordings.isPending}
						<EllipsisIcon class="size-4" />
					{:else if selectedRecordings.some(
						(recording) => recording.transcriptionStatus === 'completed',
					)}
						<RetryTranscriptionIcon class="size-4" />
					{:else}
						<StartTranscriptionIcon class="size-4" />
					{/if}
				</Button>

				<Modal.Root open={isDialogOpen} onOpenChange={(v) => (isDialogOpen = v)}>
					<Modal.Trigger>
						<Button
							tooltip={m.recordings_copy_transcripts_from_selected_recordings()}
							aria-label={m.recordings_copy_transcripts_from_selected_recordings()}
							variant="outline"
							size="icon-sm"
						>
							<CopyIcon class="size-4" />
						</Button>
					</Modal.Trigger>
					<Modal.Content>
						<Modal.Header>
							<Modal.Title>{m.recordings_copy_transcripts()}</Modal.Title>
							<Modal.Description>
								{m.recordings_choose_the_template_and_delimiter_for_the()}
							</Modal.Description>
						</Modal.Header>
						<div class="grid gap-4 py-4">
							<div class="grid grid-cols-4 items-center gap-4">
								<Label for="template" class="text-right"
									>{m.recordings_template()}</Label
								>
								<Textarea id="template" bind:value={template} class="col-span-3" />
							</div>
							<div class="grid grid-cols-4 items-center gap-4">
								<Label for="delimiter" class="text-right"
									>{m.recordings_delimiter()}</Label
								>
								<Textarea
									id="delimiter"
									bind:value={delimiter}
									class="col-span-3"
								/>
							</div>
						</div>
						<Textarea
							placeholder={m.recordings_preview_of_copied_text()}
							readonly
							class="h-32"
							value={joinedTranscriptionsText}
						/>
						<Modal.Footer>
							<CopyButton
								text={joinedTranscriptionsText}
								copyFn={createCopyFn('transcripts')}
								size="default"
								onCopy={(status) => {
									if (status === 'success') isDialogOpen = false;
								}}
							>
								{m.recordings_copy_transcriptions()}
							</CopyButton>
						</Modal.Footer>
					</Modal.Content>
				</Modal.Root>

				<Button
					tooltip={m.recordings_delete_selected_recordings()}
					aria-label={m.recordings_delete_selected_recordings()}
					variant="outline"
					size="icon-sm"
					onclick={() =>
						deleteRecordingsWithConfirmation(app, selectedRecordings)}
				>
					<TrashIcon class="size-4" />
				</Button>
			{/if}
		</div>
	{/if}

	<div class="flex-1 overflow-auto px-6 pt-2 pb-6">
		{#each groups as group (group.key)}
			<h2
				class="px-3 pt-3.5 pb-2 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
			>
				{dayLabel(group)}
			</h2>
			<ul class="flex flex-col">
				{#each group.recordings as recording (recording.id)}
					<li>
						<RecordingRow
							{recording}
							{selecting}
							selected={selected.has(recording.id)}
							onToggle={() => toggle(recording.id)}
						/>
					</li>
				{/each}
			</ul>
		{:else}
			<Empty.Root class="py-16">
				<Empty.Header>
					<Empty.Media variant="icon">
						{#if query.trim()}
							<SearchIcon />
						{:else}
							<MicIcon />
						{/if}
					</Empty.Media>
					<Empty.Title>
						{query.trim() ? 'No recordings found' : 'No recordings yet'}
					</Empty.Title>
					<Empty.Description>
						{query.trim()
							? 'Try a different word.'
							: 'Start recording to add one.'}
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{/each}
	</div>
</main>
