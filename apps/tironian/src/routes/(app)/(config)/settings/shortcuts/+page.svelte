<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import { Button } from '@tironian/ui/button';
	import * as SectionHeader from '@tironian/ui/section-header';
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

<!-- Vivavoce 4j: one list under the tabs. The settings header already names
     the page, so this opens on its one sentence and the reset. -->
<section class="flex flex-col gap-4">
	<div class="flex items-center justify-between gap-4">
		<SectionHeader.Root>
			<SectionHeader.Title level={1} class="sr-only">
				{m.settings_title_shortcuts()}
			</SectionHeader.Title>
			<SectionHeader.Description class="text-sm">
				{m.shortcuts_description({ productName: PRODUCT_NAME })}
			</SectionHeader.Description>
		</SectionHeader.Root>
		<Button variant="outline" size="sm" onclick={reset} class="shrink-0">
			<RotateCcw class="size-4" />
			{m.shortcuts_reset_shortcuts()}
		</Button>
	</div>

	<ShortcutTable>
		{#snippet row(command)}
			<KeyboardShortcutRecorder {command} />
		{/snippet}
	</ShortcutTable>
</section>
