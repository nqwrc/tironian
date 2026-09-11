<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { cn } from '@tironian/ui/utils';
	import { dictationPath } from '$lib/constants/urls';

	let { children } = $props();
</script>

<!--
	Identity only. The capture controls this header used to carry are the record
	screen's: the device and transcription selectors live in its pipeline row,
	the recording pill owns stop and cancel on every route, and the global
	shortcut starts a capture from anywhere. Duplicating them here made the
	microphone selectable from three places and gave every non-home route a
	third layer of chrome above the rail.
-->
<header
	class={cn(
		'border-border/40 bg-background/95 supports-backdrop-filter:bg-background/60 z-10 border-b shadow-xs backdrop-blur-sm',
		'flex h-14 w-full items-center px-4 sm:px-8',
	)}
>
	<Button
		tooltip={m.config_go_home()}
		href={dictationPath('/')}
		variant="ghost"
		class="-ml-4"
	>
		<span class="text-lg font-bold">tironian</span>
	</Button>
</header>

<div class="flex-1 overflow-x-auto">{@render children()}</div>
