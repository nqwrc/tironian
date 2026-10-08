<script lang="ts">
	import { os } from '#platform/os';
	import { m } from '$lib/paraglide/messages';
	import { PRODUCT_NAME, pageTitle } from '$lib/constants/brand';
	import * as Field from '@tironian/ui/field';
	import {
		CompletionRuntimeConfig,
		SettingSwitch,
		TranscriptionRuntimeConfig,
	} from '$lib/components/settings';

	// Five stages, one short section each (Vivavoce 4d): where audio becomes
	// text, where text goes for cleanup, what happens near a password field,
	// whether to learn from corrections, and whether to use the text around
	// the cursor.
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

{#if os.isWindows}
	<section class="flex flex-col gap-4 border-t border-border/60 py-6">
		<Field.Set>
			{@render legend(m.processing_learning_from_corrections())}
			<Field.Description>
				{m.processing_learning_from_corrections_description({ productName: PRODUCT_NAME })}
			</Field.Description>
			<Field.Group class="gap-4">
				<SettingSwitch
					key="learnFromCorrectionsEnabled"
					label={m.processing_learn_from_my_corrections()}
					description={m.processing_learned_terms_reach_providers_once_accepted()}
				/>
			</Field.Group>
		</Field.Set>
	</section>

	<section class="flex flex-col gap-4 border-t border-border/60 py-6">
		<Field.Set>
			{@render legend(m.processing_text_around_the_cursor())}
			<Field.Description>
				{m.processing_text_around_the_cursor_description({ productName: PRODUCT_NAME })}
			</Field.Description>
			<Field.Group class="gap-4">
				<SettingSwitch
					key="cursorContextEnabled"
					label={m.processing_use_the_text_around_my_cursor()}
					description={m.processing_text_around_the_cursor_goes_to_providers()}
				/>
			</Field.Group>
		</Field.Set>
	</section>
{/if}
