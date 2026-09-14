<!--
	Recording: how this machine records and where the text lands. Three short
	sections a person can read without scrolling (App, Capture, Output); the
	settings almost nobody changes after the first day (recipe output, the pill's
	position, the browser bitrate) wait under one "More options" disclosure, and
	the eight sound cues collapse into one switch with the per-cue list behind it.

	The microphone is deliberately absent. It is a live control, so it lives in
	the pipeline row on the record screen, where a person deciding which
	microphone is hot is already looking.
-->
<script lang="ts">
	import { PRODUCT_NAME, pageTitle } from '$lib/constants/brand';
	import { INTERFACE_LOCALE_OPTIONS } from '$lib/constants/locales';
	import { m } from '$lib/paraglide/messages';
	import * as Alert from '@tironian/ui/alert';
	import { Button } from '@tironian/ui/button';
	import * as Field from '@tironian/ui/field';
	import InfoIcon from '@lucide/svelte/icons/info';
	import OutputDeliveryControls from '$lib/components/OutputDeliveryControls.svelte';
	import {
		AdvancedDisclosure,
		SettingSelect,
		SettingSwitch,
	} from '$lib/components/settings';
	import {
		BITRATE_OPTIONS,
		RECORDING_TRIGGER_OPTIONS,
	} from '$lib/constants/audio';
	import { formatAnchorLabel } from '$lib/recording-overlay/anchor-position';
	import {
		cancelOverlayRepositionSession,
		startOverlayRepositionSession,
	} from '$lib/recording-overlay/window-manager.tauri';
	import { report } from '$lib/report';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import { os } from '#platform/os';
	import { tauri } from '#platform/tauri';
	import { getTironianApp } from '$lib/app/context';
	import AutostartSwitch from './AutostartSwitch.svelte';
	import SoundsSetting from './SoundsSetting.svelte';

	const app = getTironianApp();

	const overlayAnchorLabel = $derived(
		formatAnchorLabel({
			xAnchor: app.settings.get('recordingOverlayXAnchor'),
			xMarginPx: app.settings.get('recordingOverlayXMarginPx'),
			yAnchor: app.settings.get('recordingOverlayYAnchor'),
			yMarginPx: app.settings.get('recordingOverlayYMarginPx'),
		}),
	);

	// A session fills the screen with the overlay window and takes its clicks, so
	// this button doubles as the way out: while one is running it cancels rather
	// than going dead, and that path does not depend on the overlay answering.
	let repositioning = $state(false);

	async function toggleReposition() {
		if (repositioning) {
			await cancelOverlayRepositionSession();
			return;
		}
		repositioning = true;
		const { error } = await startOverlayRepositionSession(app);
		repositioning = false;
		if (error) {
			report.error({ title: m.settings_couldn_t_start_repositioning(), cause: error });
		}
	}

	const showBitrate = $derived(
		app.settings.get('recordingTrigger') === 'manual' && !tauri,
	);
</script>

<svelte:head> <title>{pageTitle(m.page_title_capture_settings())}</title> </svelte:head>

{#snippet legend(text: string)}
	<Field.Legend
		variant="label"
		class="font-mono text-[10px] font-normal tracking-[0.12em] text-muted-foreground uppercase"
		>{text}</Field.Legend
	>
{/snippet}

<!-- Section ids are link targets: /settings/recording and /settings/sound
     redirect to #recording and #sounds. -->
<section id="app" class="flex scroll-mt-20 flex-col gap-4 pb-6">
	<Field.Set>
		{@render legend(m.settings_app())}
		<Field.Group class="gap-4">
			<SettingSelect
				store={app.settings}
				key="interfaceLocale"
				label={m.settings_interface_language()}
				items={INTERFACE_LOCALE_OPTIONS}
			/>
			{#if tauri}
				<AutostartSwitch autostart={tauri.autostart} />
			{/if}
		</Field.Group>
	</Field.Set>
</section>

<section
	id="recording"
	class="flex scroll-mt-20 flex-col gap-4 border-t border-border/60 py-6"
>
	<Field.Set>
		{@render legend(m.settings_capture())}
		<Field.Group class="gap-4">
			<SettingSelect
				store={app.settings}
				key="recordingTrigger"
				label={m.settings_recording_trigger()}
				items={RECORDING_TRIGGER_OPTIONS}
			/>

			{#if app.settings.get('recordingTrigger') === 'vad'}
				{#if os.isLinux}
					<Alert.Root variant="destructive">
						<InfoIcon class="size-4" />
						<Alert.Title>{m.settings_voice_activated_not_supported_on_linux()}</Alert.Title>
						<Alert.Description>
							{m.settings_voice_activated_detection_vad_requires_the()}
						</Alert.Description>
					</Alert.Root>
				{:else if tauri && os.isApple}
					<Alert.Root variant="warning">
						<InfoIcon class="size-4" />
						<Alert.Title>{m.settings_global_shortcuts_may_be_unreliable()}</Alert.Title>
						<Alert.Description>
							{m.settings_vad_uses_browser_owned_capture_macos_app_nap({ productName: PRODUCT_NAME })}
						</Alert.Description>
					</Alert.Root>
				{/if}
			{/if}

			<SettingSwitch
				key="recordingPausePlayback"
				label={m.settings_pause_playback_while_recording()}
				description={m.settings_tironian_pauses_media_playing_on_your()}
			/>

			<div id="sounds" class="flex scroll-mt-20 flex-col gap-4">
				<SoundsSetting />
			</div>
		</Field.Group>
	</Field.Set>
</section>

<section
	id="output"
	class="flex scroll-mt-20 flex-col gap-4 border-t border-border/60 py-6"
>
	<Field.Set>
		{@render legend(m.settings_output())}
		<Field.Group class="gap-4">
			<OutputDeliveryControls scope="transcription" />
		</Field.Group>
	</Field.Set>
</section>

<section class="border-t border-border/60 pt-5">
	<AdvancedDisclosure label={m.settings_more_options()}>
		<Field.Group class="gap-6">
			<Field.Set>
				<Field.Legend variant="label">{m.settings_recipe_output()}</Field.Legend>
				<Field.Description>
					{m.settings_applies_after_you_run_a_recipe_on_your()}
				</Field.Description>
				<Field.Group class="gap-4">
					<OutputDeliveryControls scope="recipe" />
				</Field.Group>
			</Field.Set>

			{#if tauri}
				<Field.Field orientation="horizontal">
					<Field.Content>
						<Field.Label>{m.settings_recording_pill_position()}</Field.Label>
						<Field.Description>
							{repositioning
								? m.settings_drag_the_pill_on_your_screen_then_save()
								: overlayAnchorLabel}
						</Field.Description>
					</Field.Content>
					<Button
						variant={repositioning ? 'secondary' : 'outline'}
						size="sm"
						onclick={toggleReposition}
					>
						{repositioning ? 'Cancel' : 'Reposition'}
					</Button>
				</Field.Field>
			{/if}

			{#if showBitrate}
				<SettingSelect
					store={deviceConfig}
					key="recording.navigator.bitrateKbps"
					label={m.settings_bitrate()}
					items={BITRATE_OPTIONS}
					description={m.settings_the_bitrate_of_the_recording_higher_values()}
				/>
			{/if}
		</Field.Group>
	</AdvancedDisclosure>
</section>
