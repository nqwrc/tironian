<!--
	The Polish control in the pipeline row.

	It used to read the state and link to Dictation to change it, which made the
	one setting a person wants mid-capture a two-screen trip. Intent is a
	boolean, so it flips here. Dictation still owns what Polish is: the
	instructions, the destination sentence, and the dictionary.

	`needs-key` is the exception and stays a link. Intent is already on there;
	what is missing is a provider, and no toggle on this row can supply one.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '@tironian/ui/button';
	import { Link } from '@tironian/ui/link';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { dictationPath } from '$lib/constants/urls';
	import { polishStatus } from '$lib/operations/run-polish';
	import { getTironianApp } from '$lib/app/context';

	const app = getTironianApp();
	const status = $derived(polishStatus(app));
	const isOn = $derived(status === 'on');
	const triggerClass =
		'h-9 shrink-0 gap-1.5 px-2 text-sm font-normal text-muted-foreground hover:text-foreground';
</script>

{#if status === 'needs-key'}
	<Link
		href={dictationPath('/settings/processing')}
		tooltip={m.polish_toggle_polish_needs_setup_transcripts()}
		class="inline-flex {triggerClass} hover:bg-accent items-center rounded-md no-underline hover:no-underline"
	>
		<KeyRoundIcon class="size-4 text-warning" />
		{m.polish_toggle_raw_output()}
	</Link>
{:else}
	<Button
		variant="ghost"
		size="sm"
		class={triggerClass}
		aria-pressed={isOn}
		tooltip={isOn
			? 'Polish is on. Turn it off to ship the raw transcript.'
			: 'Polish is off. Turn it on to clean up transcripts with AI.'}
		onclick={() => app.settings.set('polishEnabled', !isOn)}
	>
		<SparklesIcon class="size-4 {isOn ? 'text-green-500' : ''}" />
		{isOn ? 'Polish on' : 'Raw output'}
	</Button>
{/if}
