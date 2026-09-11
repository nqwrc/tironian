<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Badge } from '@tironian/ui/badge';
	import { createQuery } from '@tanstack/svelte-query';
	import type { Recording } from '$lib/state/recordings.svelte';
	import { getWhisperingQueries } from '$lib/whispering/context';

	const queries = getWhisperingQueries();

	let {
		recording,
	}: {
		recording: Pick<Recording, 'id' | 'audioBlobId'>;
	} = $props();

	const availability = createQuery(
		() => queries.audio.availability(() => recording).options,
	);

	const labels = {
		available: 'On this device',
		unavailable: 'Audio missing',
	} as const;
</script>

{#if availability.data}
	<Badge variant={availability.data === 'unavailable' ? 'destructive' : 'secondary'}>
		{labels[availability.data]}
	</Badge>
{:else if availability.isError}
	<Badge variant="destructive">{m.recording_storage_badge_storage_error()}</Badge>
{:else}
	<Badge variant="secondary">Checking...</Badge>
{/if}
