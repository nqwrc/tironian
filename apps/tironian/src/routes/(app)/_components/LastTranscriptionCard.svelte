<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { CopyButton } from '@tironian/ui/copy-button';
	import type { Recording } from '$lib/app/recording';
	import { dictationPath } from '$lib/constants/urls';
	import { createCopyFn } from '$lib/utils/createCopyFn';

	// The newest recording as the Vivavoce Home (4b) shows it: when and how long,
	// two lines of what was said, and the two things done with it next. The
	// player and delete live on the recordings list, one click away.
	let { recording }: { recording: Recording } = $props();

	const text = $derived(recording.polishedTranscript ?? recording.transcript);
	const time = $derived(
		new Date(recording.recordedAt).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		}),
	);
	const duration = $derived.by(() => {
		if (recording.duration === null) return null;
		const total = Math.round(recording.duration / 1000);
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	});
	const empty = $derived.by(() => {
		if (recording.transcriptionStatus === 'pending')
			return m.home_transcribing();
		if (recording.transcriptionStatus === 'failed')
			return recording.transcriptionError ?? m.home_transcription_failed();
		return m.home_no_words();
	});
</script>

<section
	class="w-full rounded-xl border bg-card p-4"
	aria-label={m.home_last_transcription()}
>
	<div class="flex items-center gap-2.5">
		<span
			class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase"
			>{m.home_last_transcription()}</span
		>
		<span class="font-mono text-[11px] text-muted-foreground/70 tabular-nums"
			>{time}{#if duration}&nbsp;·&nbsp;{duration}{/if}</span
		>
		<span class="flex-1"></span>
		<CopyButton
			{text}
			copyFn={createCopyFn('transcript')}
			disabled={!text.trim()}
			size="sm"
			class="h-7 px-2 text-xs text-muted-foreground"
			>{m.home_copy()}</CopyButton
		>
		<Button
			variant="ghost"
			size="sm"
			class="h-7 px-2 text-xs text-muted-foreground"
			href={dictationPath('/recordings')}>{m.home_open()}</Button
		>
	</div>
	{#if text.trim()}
		<p class="mt-2.5 line-clamp-2 text-sm leading-relaxed text-foreground/85">
			{text}
		</p>
	{:else}
		<p class="mt-2.5 text-sm text-muted-foreground">{empty}</p>
	{/if}
</section>
