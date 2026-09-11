<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import { Button } from '@tironian/ui/button';
	import * as SectionHeader from '@tironian/ui/section-header';
	import { Separator } from '@tironian/ui/separator';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { report } from '$lib/report';
	import { createAppShortcuts } from '$lib/platform/shortcuts';
	import { getTironianApp } from '$lib/app/context';
	import KeyboardShortcutRecorder from './keyboard-shortcut-recorder/KeyboardShortcutRecorder.svelte';
	import ShortcutTable from './keyboard-shortcut-recorder/ShortcutTable.svelte';

	// One flat list, no platform branch (ADR-0052): every command gets one
	// router-driven recorder. The reach of the key the user presses, not a scope
	// tab, decides whether a binding lands in the synced focused store or the
	// per-device global store. Reset restores both stores to their defaults.
	function reset() {
		createAppShortcuts(getTironianApp()).reset();
		report.success({
			title: m.shortcuts_shortcuts_reset(),
			description: m.shortcuts_all_shortcuts_have_been_reset_to_defaults(),
		});
	}
</script>

<svelte:head> <title>{pageTitle(m.settings_title_shortcuts())}</title> </svelte:head>

<section class="mx-auto max-w-4xl py-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<SectionHeader.Root>
			<SectionHeader.Title level={1} class="text-3xl">
				{m.settings_title_shortcuts()}
			</SectionHeader.Title>
			<SectionHeader.Description class="mt-2">
				{m.shortcuts_description({ productName: PRODUCT_NAME })}
			</SectionHeader.Description>
		</SectionHeader.Root>
		<Button variant="outline" size="sm" onclick={reset} class="shrink-0">
			<RotateCcw class="size-4" />
			{m.shortcuts_reset_shortcuts()}
		</Button>
	</div>

	<Separator class="my-6" />

	<ShortcutTable>
		{#snippet row(command)}
			<KeyboardShortcutRecorder {command} />
		{/snippet}
	</ShortcutTable>
</section>
