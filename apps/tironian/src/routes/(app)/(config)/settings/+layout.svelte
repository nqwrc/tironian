<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import * as SectionHeader from '@tironian/ui/section-header';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { report } from '$lib/report';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import GroupNav from './GroupNav.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	let { children } = $props();
</script>

<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col px-9 pt-6 pb-4">
	<div class="flex items-center justify-between gap-4 pb-4">
		<SectionHeader.Root class="space-y-0.5">
			<SectionHeader.Title level={2} class="text-xl font-semibold tracking-tight"
				>{m.nav_settings()}</SectionHeader.Title
			>
			<SectionHeader.Description class="sr-only">
				{m.settings_customize({ productName: PRODUCT_NAME })}
			</SectionHeader.Description>
		</SectionHeader.Root>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				confirmationDialog.open({
					title: 'Reset All Settings',
					description:
						'This will reset all settings to their default values. This action cannot be undone.',
					confirm: { text: 'Reset Settings', variant: 'destructive' },
					onConfirm: () => {
						app.settings.reset();
						deviceConfig.reset();
						report.success({
							title: 'Settings reset',
							description: 'All settings have been reset to defaults.',
						});
					},
				});
			}}
			class="shrink-0 text-muted-foreground"
		>
			<RotateCcw class="size-4" />
			{m.settings_reset_to_defaults()}
		</Button>
	</div>
	<GroupNav />
	<div class="flex-1 pt-6">{@render children()}</div>
</main>
