<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Badge } from '@tironian/ui/badge';
	import { Button } from '@tironian/ui/button';
	import { Checkbox } from '@tironian/ui/checkbox';
	import { CopyButton } from '@tironian/ui/copy-button';
	import { cn } from '@tironian/ui/utils';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { getTironianApp } from '$lib/app/context';
	import { deleteRecordingsWithConfirmation } from '$lib/operations/delete-recordings';
	import type { Recording } from '$lib/state/recordings.svelte';
	import { createCopyFn } from '$lib/utils/createCopyFn';
	import TranscribeRecordingButton from './actions/TranscribeRecordingButton.svelte';
	import RecordingDetailModal from './RecordingDetailModal.svelte';
	import { formatClock } from './recording-groups';

	/**
	 * One recording as a row of the Vivavoce list (4c): time, one line of text,
	 * duration, and on hover the actions worth firing without opening anything.
	 * The row opens the detail modal, which plays the audio and holds the rest.
	 * In select mode the row toggles its checkbox instead.
	 */
	let {
		recording,
		selecting,
		selected,
		onToggle,
	}: {
		recording: Recording;
		selecting: boolean;
		selected: boolean;
		onToggle: () => void;
	} = $props();

	const app = getTironianApp();

	const text = $derived(recording.polishedTranscript ?? recording.transcript);
	const time = $derived(
		new Date(recording.recordedAt).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		}),
	);
	const duration = $derived(
		recording.duration === null ? '' : formatClock(recording.duration),
	);
</script>

{#snippet summary()}
	<span
		class="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
		>{time}</span
	>
	<span
		class={cn(
			'min-w-0 flex-1 truncate text-[13.5px]',
			text.trim()
				? 'text-foreground/85 group-hover:text-foreground'
				: 'text-muted-foreground italic',
		)}>{text.trim() || m.recording_row_no_text_yet()}</span
	>
{/snippet}

<div
	class={cn(
		'group flex items-center gap-4 rounded-md px-3 py-2 transition-colors duration-(--motion-micro) hover:bg-accent',
		selected && 'bg-accent',
	)}
>
	{#if selecting}
		<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
			<Checkbox
				checked={selected}
				onCheckedChange={onToggle}
				aria-label={m.recording_row_select()}
			/>
			{@render summary()}
		</label>
	{:else}
		<RecordingDetailModal {recording}>
			{#snippet trigger(props)}
				<button
					{...props}
					type="button"
					class="flex min-w-0 flex-1 items-center gap-4 rounded-sm py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{@render summary()}
				</button>
			{/snippet}
		</RecordingDetailModal>
	{/if}

	{#if recording.transcriptionStatus === 'failed'}
		<Badge
			variant="status.failed"
			title={recording.transcriptionError ?? undefined}
			>{m.transcription_status_badge_failed()}</Badge
		>
	{/if}

	{#if !selecting}
		<span
			class="flex items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-micro) group-focus-within:opacity-100 group-hover:opacity-100"
		>
			<CopyButton
				{text}
				copyFn={createCopyFn('transcript')}
				disabled={!text.trim()}
				size="icon-sm"
				class="text-muted-foreground"
				aria-label={m.recording_row_copy()}
			/>
			<TranscribeRecordingButton {recording} />
			<Button
				variant="ghost"
				size="icon-sm"
				class="text-muted-foreground hover:text-destructive"
				tooltip={m.recording_row_delete()}
				aria-label={m.recording_row_delete()}
				onclick={() => deleteRecordingsWithConfirmation(app, recording)}
			>
				<TrashIcon class="size-3.5" />
			</Button>
		</span>
	{/if}

	<span
		class="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums"
		>{duration}</span
	>
</div>
