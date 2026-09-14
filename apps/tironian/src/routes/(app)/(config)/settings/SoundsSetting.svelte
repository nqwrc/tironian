<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Field from '@tironian/ui/field';
	import { Switch } from '@tironian/ui/switch';
	import { AdvancedDisclosure, SettingSwitch } from '$lib/components/settings';
	import type { BooleanSettingKey } from '$lib/state/settings.svelte';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();

	// Eight cue switches read as eight decisions, and almost everyone makes the
	// same one for all of them. So the page asks once: one switch drives every
	// cue, and the per-cue list stays one click away for the person who wants
	// the start chime without the stop chime. Each cue keeps its own setting;
	// the master switch only writes them together.
	const CUES = [
		{ key: 'soundManualStart', label: m.settings_play_sound_when_starting_manual_recording() },
		{ key: 'soundManualStop', label: m.settings_play_sound_when_stopping_manual_recording() },
		{ key: 'soundManualCancel', label: m.settings_play_sound_when_canceling_manual_recording() },
		{ key: 'soundVadStart', label: m.settings_play_sound_when_starting_vad_recording() },
		{ key: 'soundVadCapture', label: m.settings_play_sound_on_vad_capture() },
		{ key: 'soundVadStop', label: m.settings_play_sound_when_stopping_vad_recording() },
		{ key: 'soundTranscriptionComplete', label: m.settings_play_sound_after_transcription() },
		{ key: 'soundRecipeComplete', label: m.settings_play_sound_after_a_recipe_runs() },
	] as const satisfies readonly { key: BooleanSettingKey; label: string }[];

	const onCount = $derived(CUES.filter((cue) => app.settings.get(cue.key)).length);

	function setAll(checked: boolean) {
		for (const cue of CUES) app.settings.set(cue.key, checked);
	}

	const id = $props.id();
</script>

<Field.Field orientation="horizontal">
	<Field.Content>
		<Field.Label for={id}>{m.settings_sounds()}</Field.Label>
		<Field.Description>
			{m.settings_sounds_count({ on: onCount, total: CUES.length })}
		</Field.Description>
	</Field.Content>
	<Switch {id} checked={onCount > 0} onCheckedChange={setAll} />
</Field.Field>

<AdvancedDisclosure label={m.settings_choose_sounds()}>
	<Field.Group class="gap-3">
		{#each CUES as cue (cue.key)}
			<SettingSwitch key={cue.key} label={cue.label} />
		{/each}
	</Field.Group>
</AdvancedDisclosure>
