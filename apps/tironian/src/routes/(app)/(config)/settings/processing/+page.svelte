<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import * as Field from '@tironian/ui/field';
	import {
		CompletionRuntimeConfig,
		SettingSwitch,
		TranscriptionRuntimeConfig,
	} from '$lib/components/settings';
</script>

<svelte:head> <title>{pageTitle(m.settings_title_processing())}</title> </svelte:head>

<Field.Set>
	<Field.Legend>{m.processing_privacy_amp_processing()}</Field.Legend>
	<Field.Description>
		{m.processing_choose_where_each_stage_of_the_pipeline()}
	</Field.Description>
	<Field.Separator />
	<Field.Group>
		<Field.Set>
			<Field.Legend variant="label">{m.processing_audio_transcription()}</Field.Legend>
			<Field.Description>
				{m.processing_where_your_recording_is_turned_into_text()}
			</Field.Description>
			<TranscriptionRuntimeConfig />
		</Field.Set>

		<Field.Separator />

		<Field.Set>
			<Field.Legend variant="label">{m.processing_text_polish_amp_recipes()}</Field.Legend>
			<Field.Description>
				{m.processing_where_transcript_text_goes_for_ai_cleanup()}
			</Field.Description>
			<CompletionRuntimeConfig />
		</Field.Set>

		<Field.Separator />

		<Field.Set>
			<Field.Legend variant="label">{m.processing_password_fields()}</Field.Legend>
			<Field.Description>
				{m.processing_detection_is_best_effort_it_blocks_when_a()}
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="secureFieldGuardEnabled"
					label={m.processing_hold_delivery_when_a_password_field_has()}
					description={m.processing_the_transcript_stays_in_your_history()}
				/>
				<SettingSwitch
					key="secureFieldCaptureGateEnabled"
					label={m.processing_also_refuse_to_start_recording()}
					description={m.processing_stops_a_dictated_secret_from_ever_reaching()}
				/>
			</Field.Group>
		</Field.Set>
	</Field.Group>
</Field.Set>
