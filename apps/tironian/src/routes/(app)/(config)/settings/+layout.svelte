<script lang="ts">
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { confirmationDialog } from '@tironian/ui/confirmation-dialog';
	import * as SectionHeader from '@tironian/ui/section-header';
	import { Separator } from '@tironian/ui/separator';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { report } from '$lib/report';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import GroupNav from './GroupNav.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	let { children } = $props();
</script>

<main class="flex w-full flex-1 flex-col pb-4 pt-2 px-4 mx-auto max-w-6xl">
	<div
		class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<SectionHeader.Root class="space-y-0.5">
			<SectionHeader.Title level={2} class="text-2xl font-bold tracking-tight"
				>{m.nav_settings()}</SectionHeader.Title
			>
			<SectionHeader.Description>
				{m.settings_customize({ productName: PRODUCT_NAME })}
			</SectionHeader.Description>
		</SectionHeader.Root>
		<Button
			variant="outline"
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
			class="shrink-0"
		>
			<RotateCcw class="size-4" />
			{m.settings_reset_to_defaults()}
		</Button>
	</div>
	<Separator class="my-6" />
	<GroupNav />
	<main class="flex-1 p-1.5 pt-6 lg:max-w-3xl">{@render children()}</main>
</main>
