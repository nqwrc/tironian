<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '@tironian/ui/input';
	import Search from '@lucide/svelte/icons/search';
	import type { Snippet } from 'svelte';
	import { type Command, commands } from '$lib/commands';

	// Platform-agnostic chrome: a searchable list of every command (Vivavoce 4j:
	// one list, the key you press decides where it works). The caller owns what
	// a row's shortcut control is (the reach-routed keyboard recorder) and
	// supplies it through the `row` snippet, so this component holds no
	// local/global discriminator.
	let { row }: { row: Snippet<[Command]> } = $props();

	let searchQuery = $state('');

	const filteredCommands = $derived(
		commands.filter((command) =>
			command.title.toLowerCase().includes(searchQuery.toLowerCase()),
		),
	);
</script>

<div class="flex flex-col gap-3">
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			type="search"
			placeholder={m.shortcut_table_search_commands()}
			class="h-8 pl-8 text-sm"
			bind:value={searchQuery}
		/>
	</div>

	<ul class="-mx-3 flex flex-col" aria-label={m.shortcut_table_command()}>
		{#each filteredCommands as command (command.id)}
			<li
				class="flex items-center justify-between gap-4 rounded-md px-3 py-1.5 transition-colors duration-(--motion-micro) hover:bg-accent/50"
			>
				<span class="min-w-0 truncate text-sm">{command.title}</span>
				{@render row(command)}
			</li>
		{/each}
	</ul>
</div>
