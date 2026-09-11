<!--
	Capture: everything about how this machine records, from the moment a capture
	starts to the moment the text lands somewhere. It absorbed the old Recording
	and Sound pages, which were a menu entry each for one select and eight
	switches.

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
	import { Link } from '@tironian/ui/link';
	import InfoIcon from '@lucide/svelte/icons/info';
	import OutputDeliveryControls from '$lib/components/OutputDeliveryControls.svelte';
	import { SettingSelect, SettingSwitch } from '$lib/components/settings';
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
</script>

<svelte:head> <title>{pageTitle(m.page_title_capture_settings())}</title> </svelte:head>

<!--
	Interface language leads the settings, above Capture, because it changes every
	other label on the page. It is a preference about the app rather than about a
	capture, which is why it is its own set instead of a row inside one.
-->
<Field.Set>
	<Field.Legend>{m.settings_interface()}</Field.Legend>
	<Field.Group>
		<SettingSelect
			store={app.settings}
			key="interfaceLocale"
			label={m.settings_interface_language()}
			items={INTERFACE_LOCALE_OPTIONS}
			description={m.settings_interface_language_description({
				productName: PRODUCT_NAME,
			})}
		/>
	</Field.Group>
</Field.Set>

<Field.Set>
	<Field.Legend>{m.settings_capture()}</Field.Legend>
	<Field.Description>
		{m.settings_how_this_machine_records_what_it_sounds_like()}
	</Field.Description>
	<Field.Separator />
	<Field.Group>
		<Field.Set id="recording" class="scroll-mt-20">
			<Field.Legend variant="label">{m.settings_recording()}</Field.Legend>
			<Field.Description>
				{m.settings_how_a_capture_starts_and_what_it_does()}
			</Field.Description>
			<Field.Group>
				<SettingSelect
					store={app.settings}
					key="recordingTrigger"
					label={m.settings_recording_trigger()}
					items={RECORDING_TRIGGER_OPTIONS}
					description="Choose how recording starts: {RECORDING_TRIGGER_OPTIONS.map(
						(option) => option.label.toLowerCase(),
					).join(', ')}"
				/>

				<SettingSwitch
					key="recordingPausePlayback"
					label={m.settings_pause_playback_while_recording()}
					description={m.settings_tironian_pauses_media_playing_on_your({ productName: PRODUCT_NAME })}
				/>

				{#if app.settings.get('recordingTrigger') === 'vad'}
					{#if os.isLinux}
						<Alert.Root variant="destructive">
							<InfoIcon class="size-4" />
							<Alert.Title>{m.settings_voice_activated_not_supported_on_linux()}</Alert.Title>
							<Alert.Description>
								{m.settings_voice_activated_detection_vad_requires_the()}
								<Link
									href="https://github.com/TironianHQ/tironian/issues/839"
									target="_blank"
								>
									{m.settings_learn_more()}
								</Link>
							</Alert.Description>
						</Alert.Root>
					{:else}
						{#if tauri && os.isApple}
							<Alert.Root variant="warning">
								<InfoIcon class="size-4" />
								<Alert.Title>{m.settings_global_shortcuts_may_be_unreliable()}</Alert.Title>
								<Alert.Description>
									{m.settings_vad_uses_browser_owned_capture_macos_app_nap({ productName: PRODUCT_NAME })}
								</Alert.Description>
							</Alert.Root>
						{/if}
						<Alert.Root>
							<InfoIcon class="size-4" />
							<Alert.Title>{m.settings_voice_activated_detection()}</Alert.Title>
							<Alert.Description>
								{m.settings_vad_uses_the_browser_s_web_audio_api()}
							</Alert.Description>
						</Alert.Root>
					{/if}
				{/if}

				{#if app.settings.get('recordingTrigger') === 'manual' && !tauri}
					<SettingSelect
						store={deviceConfig}
						key="recording.navigator.bitrateKbps"
						label={m.settings_bitrate()}
						items={BITRATE_OPTIONS}
						description={m.settings_the_bitrate_of_the_recording_higher_values()}
					/>
				{/if}
			</Field.Group>
		</Field.Set>

		<Field.Separator />

		<Field.Set id="output" class="scroll-mt-20">
			<Field.Legend variant="label">{m.settings_output()}</Field.Legend>
			<Field.Description>{m.settings_where_the_text_goes_once_it_is_ready()}</Field.Description>
			<Field.Group>
				<Field.Set>
					<Field.Legend variant="label">{m.settings_transcription_output()}</Field.Legend>
					<Field.Description>
						{m.settings_applies_immediately_after_an_audio()}
					</Field.Description>
					<Field.Group>
						<OutputDeliveryControls scope="transcription" />
					</Field.Group>
				</Field.Set>

				<Field.Set>
					<Field.Legend variant="label">{m.settings_recipe_output()}</Field.Legend>
					<Field.Description>
						{m.settings_applies_after_you_run_a_recipe_on_your()}
					</Field.Description>
					<Field.Group>
						<OutputDeliveryControls scope="recipe" />
					</Field.Group>
				</Field.Set>
			</Field.Group>
		</Field.Set>

		<Field.Separator />

		<Field.Set id="sounds" class="scroll-mt-20">
			<Field.Legend variant="label">{m.settings_sounds()}</Field.Legend>
			<Field.Description>
				{m.settings_audio_cues_for_the_moments_you_cannot_see()}
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="soundManualStart"
					label={m.settings_play_sound_when_starting_manual_recording()}
				/>
				<SettingSwitch
					key="soundManualStop"
					label={m.settings_play_sound_when_stopping_manual_recording()}
				/>
				<SettingSwitch
					key="soundManualCancel"
					label={m.settings_play_sound_when_canceling_manual_recording()}
				/>
				<SettingSwitch
					key="soundVadStart"
					label={m.settings_play_sound_when_starting_vad_recording()}
				/>
				<SettingSwitch key="soundVadCapture" label={m.settings_play_sound_on_vad_capture()} />
				<SettingSwitch
					key="soundVadStop"
					label={m.settings_play_sound_when_stopping_vad_recording()}
				/>
				<SettingSwitch
					key="soundTranscriptionComplete"
					label={m.settings_play_sound_after_transcription()}
				/>
				<SettingSwitch
					key="soundRecipeComplete"
					label={m.settings_play_sound_after_a_recipe_runs()}
				/>
			</Field.Group>
		</Field.Set>

		{#if tauri}
			<Field.Separator />

			<Field.Set id="app" class="scroll-mt-20">
				<Field.Legend variant="label">{m.settings_machine_legend({ productName: PRODUCT_NAME })}</Field.Legend>
				<Field.Description>
					{m.settings_whether_tironian_is_running_and_ready_to({ productName: PRODUCT_NAME })}
				</Field.Description>
				<Field.Group>
					<AutostartSwitch autostart={tauri.autostart} />

					<Field.Field>
						<Field.Label>{m.settings_recording_pill_position()}</Field.Label>
						<Field.Description>
							Where the floating pill appears while you dictate. Currently: {overlayAnchorLabel}.
						</Field.Description>
						<div class="flex gap-2">
							<Button
								variant={repositioning ? 'secondary' : 'outline'}
								size="sm"
								class="w-fit"
								onclick={toggleReposition}
							>
								{repositioning ? 'Cancel repositioning' : 'Reposition'}
							</Button>
						</div>
						{#if repositioning}
							<p class="text-muted-foreground text-sm">
								{m.settings_drag_the_pill_on_your_screen_then_save()}
							</p>
						{/if}
					</Field.Field>
				</Field.Group>
			</Field.Set>
		{/if}
	</Field.Group>
</Field.Set>
