<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { createQuery } from '@tanstack/svelte-query';
	import type { Recording } from '$lib/state/recordings.svelte';
	import RenderAudioUrl from './RenderAudioUrl.svelte';
	import { getTironianQueries } from '$lib/app/context';

	const queries = getTironianQueries();

	let { recording }: { recording: Recording } = $props();
	const availability = createQuery(
		() => queries.audio.availability(() => recording).options,
	);
</script>

{#if availability.data === 'available'}
	<RenderAudioUrl id={recording.id} audioBlobId={recording.audioBlobId} />
{:else if availability.data}
	<span class="text-muted-foreground text-sm">{m.recording_audio_cell_not_on_this_device()}</span>
{/if}
