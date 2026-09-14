<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Kbd from '@tironian/ui/kbd';
	import { Link } from '@tironian/ui/link';
	import { Spinner } from '@tironian/ui/spinner';
	import { cn } from '@tironian/ui/utils';
	import { getTironianApp } from '$lib/app/context';
	import tironianMark from '$lib/assets/tironian-mark.png';
	import { dictationPath } from '$lib/constants/urls';
	import { createManualRecordingController } from './manual-recording-controller.svelte';

	// Home's listening surface from the Vivavoce shell (4b): one mark to click, a
	// line saying what the recorder is doing, and the shortcut that does the same
	// from any app. It drives the manual recorder through the same controller as
	// the record card, so the two cannot disagree about state.
	const rec = createManualRecordingController(getTironianApp());

	const headline = $derived(
		rec.pending
			? m.home_finishing()
			: rec.active
				? m.home_listening()
				: m.home_ready_to_listen(),
	);
</script>

<div class="flex flex-col items-center gap-6 text-center">
	<button
		type="button"
		onclick={rec.toggle}
		disabled={rec.pending}
		aria-label={rec.shortcutLabel
			? `${rec.label} (${rec.shortcutLabel})`
			: rec.label}
		aria-pressed={rec.active}
		aria-busy={rec.pending}
		title={rec.tooltip}
		class={cn(
			'flex size-26 items-center justify-center rounded-full border bg-card transition-[box-shadow,border-color] duration-(--motion-micro) ease-out hover:border-foreground/20 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			rec.active && 'border-voce ring-4 ring-voce/20',
			rec.pending && 'cursor-wait',
		)}
	>
		{#if rec.pending}
			<Spinner class="size-8" />
		{:else}
			<img src={tironianMark} alt="" class="size-10" />
		{/if}
	</button>

	<div class="flex flex-col gap-2">
		<h1 class="text-[22px] font-semibold tracking-tight" aria-live="polite">
			{headline}
		</h1>
		<p class="text-sm text-muted-foreground">
			{#if rec.shortcutLabel}
				{m.home_press()}
				<Kbd.Root class="mx-0.5 font-mono text-xs">{rec.shortcutLabel}</Kbd.Root>
				{m.home_in_any_app()}
			{:else}
				{m.home_click_the_mark()}
				<Link href={dictationPath('/settings/shortcuts')}
					>{m.app_set_a_shortcut()}</Link
				>
			{/if}
		</p>
	</div>
</div>
