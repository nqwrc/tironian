<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { extractErrorMessage } from 'wellcrafted/error';
	import { InstantString } from '@tironian/field';
	import { Button } from '@tironian/ui/button';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import { CopyButton } from '@tironian/ui/copy-button';
	import { Input } from '@tironian/ui/input';
	import { Label } from '@tironian/ui/label';
	import * as Modal from '@tironian/ui/modal';
	import { Separator } from '@tironian/ui/separator';
	import { Textarea } from '@tironian/ui/textarea';
	import { TimezoneCombobox } from '@tironian/ui/timezone-combobox';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { createQuery } from '@tanstack/svelte-query';
	import type { Snippet } from 'svelte';
	import AudioBlobPlayer from '$lib/components/AudioBlobPlayer.svelte';
	import { deleteRecordingsWithConfirmation } from '$lib/operations/delete-recordings';
	import { report } from '$lib/report';
	import type { Recording } from '$lib/state/recordings.svelte';
	import { createCopyFn } from '$lib/utils/createCopyFn';
	import DownloadRecordingButton from './actions/DownloadRecordingButton.svelte';
	import TranscribeRecordingButton from './actions/TranscribeRecordingButton.svelte';
	import RecordingStorageBadge from './RecordingStorageBadge.svelte';
	import {
		getTironianApp,
		getTironianQueries,
	} from '$lib/app/context';

	const app = getTironianApp();
	const queries = getTironianQueries();

	/**
	 * The single detail surface for one recording: play it back, read and edit
	 * its transcript and metadata, run transcription, download it, copy the
	 * transcript, or delete it.
	 *
	 * The opener is supplied by the caller via the `trigger` snippet, so the
	 * same modal can be reached from the transcript cell (the textarea preview)
	 * or any other affordance without this component owning a button shape.
	 */
	let {
		recording,
		trigger,
	}: {
		recording: Recording;
		/** Renders the modal opener; spread the given props onto a single element. */
		trigger: Snippet<[Record<string, unknown>]>;
	} = $props();

	let isDialogOpen = $state(false);

	/**
	 * A working copy of the recording that we can safely edit.
	 *
	 * It's like a photocopy of an important document. You don't want to
	 * accidentally mess up the original. You edit the photocopy, submit it,
	 * and the original is updated. Then you get a new photocopy.
	 */
	let workingCopy = $derived(
		// Reset the working copy when new recording data comes in.
		recording,
	);

	/**
	 * Tracks whether the user has made changes to the working copy. Starts
	 * false on fresh upstream data, flips true on the first edit, and resets
	 * when new data arrives or the user saves. Drives the unsaved-changes
	 * prompt and the disabled state of the save button.
	 */
	let isWorkingCopyDirty = $derived.by(() => {
		// Reset dirty flag when new recording data comes in
		recording;
		return false;
	});

	/**
	 * Audio playback URL via TanStack Query, fetched lazily once the modal
	 * opens. Gating on `isDialogOpen` keeps closed rows from eagerly acquiring
	 * local blob URLs.
	 */
	const audioAvailabilityQuery = createQuery(() => ({
		...queries.audio.availability(() => recording).options,
		enabled: isDialogOpen,
	}));

	const deliveredTranscript = $derived(
		workingCopy.polishedTranscript ?? workingCopy.transcript,
	);

	function promptUserConfirmLeave() {
		if (!isWorkingCopyDirty) {
			isDialogOpen = false;
			return;
		}

		confirmationDialog.open({
			title: m.recording_detail_modal_unsaved_changes(),
			description: m.recording_detail_modal_you_have_unsaved_changes_are(),
			confirm: { text: 'Leave' },
			onConfirm: () => {
				// Reset working copy and dirty flag
				workingCopy = recording;
				isWorkingCopyDirty = false;

				isDialogOpen = false;
			},
		});
	}

	function save() {
		const snapshot = $state.snapshot(workingCopy);
		if (!InstantString.is(snapshot.recordedAt)) {
			report.info({
				title: m.recording_detail_modal_recorded_at_is_not_a_valid(),
				description: m.recording_detail_modal_use_a_utc_iso_timestamp_like(),
			});
			return;
		}

		try {
			app.recordings.patch(recording.id, {
				title: snapshot.title,
				recordedAt: snapshot.recordedAt,
				recordedAtZone: snapshot.recordedAtZone,
				transcript: snapshot.transcript,
				polishedTranscript:
					snapshot.transcript === recording.transcript
						? recording.polishedTranscript
						: null,
			});
		} catch (cause) {
			report.info({
				title: m.recording_detail_modal_could_not_update_recording(),
				description: extractErrorMessage(cause),
			});
			return;
		}

		report.success({
			title: m.recording_detail_modal_updated_recording(),
			description: m.recording_detail_modal_your_recording_has_been(),
		});
		isDialogOpen = false;
	}

</script>

<Modal.Root bind:open={isDialogOpen}>
	<Modal.Trigger>
		{#snippet child({ props })}
			{@render trigger(props)}
		{/snippet}
	</Modal.Trigger>
	<Modal.Content
		class="max-w-2xl"
		onEscapeKeydown={(e) => {
			e.preventDefault();
			if (isDialogOpen) promptUserConfirmLeave();
		}}
		onInteractOutside={(e) => {
			e.preventDefault();
			if (isDialogOpen) promptUserConfirmLeave();
		}}
	>
		<Modal.Header>
			<Modal.Title>{recording.title || 'Untitled recording'}</Modal.Title>
			<Modal.Description>
				{m.recording_detail_modal_play_it_back_edit_the()}
			</Modal.Description>
		</Modal.Header>

		<div class="space-y-4 p-4">
			<div class="flex items-center gap-2">
				<RecordingStorageBadge {recording} />
			</div>

			{#if audioAvailabilityQuery.data === 'available'}
				<AudioBlobPlayer
					id={recording.audioBlobId}
					enabled={isDialogOpen}
					class="h-9 w-full"
				/>
			{:else if audioAvailabilityQuery.data === 'unavailable'}
				<p class="text-destructive text-sm">
					{m.recording_detail_modal_the_audio_is_no_longer()}
				</p>
			{/if}

			{#if workingCopy.polishedTranscript}
				<div class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<Label for="delivered-transcript">{m.recording_detail_modal_delivered_transcript()}</Label>
						<CopyButton
							text={workingCopy.polishedTranscript}
							copyFn={createCopyFn('delivered transcript')}
							variant="outline"
						/>
					</div>
					<Textarea
						id="delivered-transcript"
						value={workingCopy.polishedTranscript}
						readonly
						rows={6}
					/>
				</div>
			{/if}

			<div class="space-y-2">
				<Label for="transcript">
					{workingCopy.polishedTranscript ? 'Original transcript' : 'Transcript'}
				</Label>
				<Textarea
					id="transcript"
					value={workingCopy.transcript}
					oninput={(e) => {
						workingCopy = {
							...workingCopy,
							transcript: e.currentTarget.value,
						};
						isWorkingCopyDirty = true;
					}}
					rows={12}
				/>
			</div>

			<div class="flex flex-wrap gap-2">
				<TranscribeRecordingButton
					{recording}
					variant="outline"
					size="sm"
					showLabel
				/>
				<DownloadRecordingButton
					{recording}
					variant="outline"
					size="sm"
					showLabel
				/>
			</div>

			<Separator />

			<div class="space-y-4">
				<div class="grid grid-cols-4 items-center gap-4">
					<Label for="title" class="text-right">{m.recording_detail_modal_title()}</Label>
					<Input
						id="title"
						value={workingCopy.title}
						oninput={(e) => {
							workingCopy = { ...workingCopy, title: e.currentTarget.value };
							isWorkingCopyDirty = true;
						}}
						class="col-span-3"
					/>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label for="recordedAt" class="text-right">{m.recording_detail_modal_recorded_at()}</Label>
					<Input
						id="recordedAt"
						value={workingCopy.recordedAt}
						oninput={(e) => {
							workingCopy = {
								...workingCopy,
								recordedAt: e.currentTarget.value as Recording['recordedAt'],
							};
							isWorkingCopyDirty = true;
						}}
						class="col-span-3"
					/>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{m.recording_detail_modal_recorded_timezone()}</Label>
					<div class="col-span-3">
						<TimezoneCombobox
							bind:value={() => workingCopy.recordedAtZone,
								(recordedAtZone) => {
									workingCopy = {
										...workingCopy,
										recordedAtZone:
											recordedAtZone as Recording['recordedAtZone'],
									};
									isWorkingCopyDirty = true;
								}}
						/>
					</div>
				</div>
			</div>
		</div>

		<Modal.Footer>
			<Button
				variant="destructive"
				onclick={() =>
					deleteRecordingsWithConfirmation(app, $state.snapshot(recording), {
						onSuccess: () => {
							isDialogOpen = false;
						},
					})}
			>
				<TrashIcon class="size-4" />
				{m.recording_detail_modal_delete()}
			</Button>
			<div class="flex-1"></div>
			<Button variant="outline" onclick={() => promptUserConfirmLeave()}>
				{m.text_preview_dialog_close()}
			</Button>
			<CopyButton
				text={deliveredTranscript}
				copyFn={createCopyFn('transcript')}
				variant="outline"
				size="default"
				disabled={!deliveredTranscript.trim()}
			>
				{m.recording_detail_modal_copy()}
			</CopyButton>
			<Button onclick={save} disabled={!isWorkingCopyDirty}>{m.recording_detail_modal_save()}</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
