<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { pageTitle } from '$lib/constants/brand';
	import * as Field from '@tironian/ui/field';
	import {
		CompletionRuntimeConfig,
		SettingSwitch,
		TranscriptionRuntimeConfig,
	} from '$lib/components/settings';

	// Three stages, one short section each (Vivavoce 4d): where audio becomes
	// text, where text goes for cleanup, and what happens near a password field.
	// Each section shows only the route in use; the rest waits behind its picker.
</script>

<svelte:head> <title>{pageTitle(m.settings_title_processing())}</title> </svelte:head>

{#snippet legend(text: string)}
	<Field.Legend
		variant="label"
		class="font-mono text-[10px] font-normal tracking-[0.12em] text-muted-foreground uppercase"
		>{text}</Field.Legend
	>
{/snippet}

<section class="flex flex-col gap-4 pb-6">
	<Field.Set>
		{@render legend(m.processing_audio_transcription())}
		<TranscriptionRuntimeConfig />
	</Field.Set>
</section>

<section class="flex flex-col gap-4 border-t border-border/60 py-6">
	<Field.Set>
		{@render legend(m.processing_text_polish_amp_recipes())}
		<CompletionRuntimeConfig />
	</Field.Set>
</section>

<section class="flex flex-col gap-4 border-t border-border/60 py-6">
	<Field.Set>
		{@render legend(m.processing_password_fields())}
		<Field.Description>
			{m.processing_detection_is_best_effort_it_blocks_when_a()}
		</Field.Description>
		<Field.Group class="gap-4">
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
</section>
