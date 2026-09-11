<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import * as Popover from '@tironian/ui/popover';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import OutputDeliveryControls from '$lib/components/OutputDeliveryControls.svelte';
	import { SettingSwitch } from '$lib/components/settings';
	import { captureSurface } from '$lib/state/capture-surface.svelte';
	import { getWhisperingApp } from '$lib/whispering/context';

	const app = getWhisperingApp();
	let open = $state(false);

	const pausePlaybackDescription = $derived.by(() => {
		switch (captureSurface.current(app)) {
			case 'vad':
				return 'Pause music or video while you are speaking, then try to resume shortly after you stop.';
			case 'manual':
			case 'import':
				return 'Pause music or video while you are recording, then try to resume when you stop.';
		}
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				tooltip={m.capture_behavior_popover_quick_settings()}
				aria-label={m.capture_behavior_popover_quick_settings()}
				aria-expanded={open}
				variant="ghost"
				size="icon"
			>
				<SlidersHorizontalIcon class="size-4" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-80">
		<div class="flex flex-col gap-3">
			<SettingSwitch
				key="recordingPausePlayback"
				label={m.settings_pause_playback_while_recording()}
				description={pausePlaybackDescription}
			/>
			<OutputDeliveryControls scope="transcription" />
		</div>
	</Popover.Content>
</Popover.Root>
