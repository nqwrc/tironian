<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import * as Command from '@tironian/ui/command';
	import { useCombobox } from '@tironian/ui/hooks';
	import * as Popover from '@tironian/ui/popover';
	import { Spinner } from '@tironian/ui/spinner';
	import { cn } from '@tironian/ui/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MicIcon from '@lucide/svelte/icons/mic';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { createQuery } from '@tanstack/svelte-query';
	import { report } from '$lib/report';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import { vadRecorder } from '$lib/state/vad-recorder.svelte';

	let {
		iconViewTransitionName,
	}: {
		/** When set, names the mic glyph for a cross-page view transition. */
		iconViewTransitionName?: string;
	} = $props();

	const combobox = useCombobox();

	// VAD always uses navigator device ID
	const settingKey = 'recording.navigator.deviceId';

	const selectedDeviceId = $derived(deviceConfig.get(settingKey));

	const getDevicesQuery = createQuery(() => ({
		...vadRecorder.enumerateDevices.options,
		enabled: combobox.open,
	}));

	$effect(() => {
		if (getDevicesQuery.isError) {
			report.info({ cause: getDevicesQuery.error });
		}
	});
</script>

<Popover.Root bind:open={combobox.open}>
	<Popover.Trigger bind:ref={combobox.triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				tooltip={selectedDeviceId
					? 'Change recording device'
					: 'Choose recording device'}
				role="combobox"
				aria-expanded={combobox.open}
				variant="ghost"
				size="icon"
				class="relative"
			>
				<span
					class="inline-flex shrink-0"
					style:view-transition-name={iconViewTransitionName}
				>
					{#if selectedDeviceId}
						<MicIcon class="size-4 text-green-500" />
					{:else}
						<MicIcon class="size-4 text-warning" />
					{/if}
				</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="p-0">
		<Command.Root loop>
			<Command.Input placeholder={m.vad_device_selector_select_vad_recording_device()} />
			<Command.Empty>{m.manual_device_selector_no_recording_devices_found()}</Command.Empty>
			<div class="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border-b">
				{m.vad_device_selector_voice_detection_uses_web_audio()}
			</div>
			<Command.Group class="overflow-y-auto max-h-[400px]">
				{#if getDevicesQuery.isPending}
					<div class="p-4 text-center text-sm text-muted-foreground">
						{m.vad_device_selector_loading_vad_devices()}
					</div>
				{:else if getDevicesQuery.isError}
					<div class="p-4 text-center text-sm text-destructive">
						{getDevicesQuery.error.message}
					</div>
				{:else}
					{#each getDevicesQuery.data as device (device.id)}
						<Command.Item
							value={device.id}
							onSelect={() => {
								deviceConfig.set(
									settingKey,
									selectedDeviceId === device.id ? null : device.id,
								);
								combobox.closeAndFocusTrigger();
							}}
						>
							<CheckIcon
								class={cn(
									'mr-2 size-4',
									selectedDeviceId === device.id ? 'opacity-100' : 'opacity-0',
								)}
							/>
							{device.label}
						</Command.Item>
					{/each}
				{/if}
			</Command.Group>
			<Command.Separator />
			<Command.Group>
				<Command.Item
					onSelect={() => {
						getDevicesQuery.refetch();
					}}
				>
					{#if getDevicesQuery.isRefetching}
						<Spinner />
					{:else}
						<RefreshCwIcon class="size-4" />
					{/if}
					Refresh devices
				</Command.Item>
			</Command.Group>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
