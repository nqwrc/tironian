<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '@tironian/ui/utils';
	import type { Snippet } from 'svelte';

	let {
		children,
		class: className,
	}: {
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div
	class={cn('flex w-full items-center gap-1.5', className)}
	role="group"
	aria-label={m.capture_pipeline_recording_setup()}
>
	{@render children()}
</div>
