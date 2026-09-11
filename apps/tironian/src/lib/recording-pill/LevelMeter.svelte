<script lang="ts">
	import { cn } from '@tironian/ui/utils';

	// The pill's live mic meter: a fixed bank of bars whose heights ride the
	// smoothed `level`. The pill styles the bars (width, color) and the container
	// (height, gap); the defaults render its 3px white bar, and a VAD session
	// tints the bars via `barClass` when speech latches.
	let {
		level,
		bars = 11,
		minPx = 3,
		maxPx = 18,
		barClass,
		class: className,
	}: {
		/** Smoothed mic loudness, 0 (silent) to 1 (loud). */
		level: number;
		/** Bar count. Defaults to the original 11-bar meter. */
		bars?: number;
		/** Bar height floor (silent) and ceiling (loud), in px. */
		minPx?: number;
		maxPx?: number;
		/** Per-bar classes: width and color. */
		barClass?: string;
		/** Container classes: height and gap. */
		class?: string;
	} = $props();

	// Per-bar height envelope (taller in the middle) scaled by `level`. Reacting
	// the same amplitude through a fixed shape reads as a meter, not a flat block.
	// Generated rather than hardcoded so callers can pick any bar count (the
	// desktop overlay's 7-bar waveform vs. this file's original 11-bar meter) and
	// still get the same quieter-at-the-edges silhouette.
	const ENVELOPE = $derived.by((): number[] => {
		const mid = (bars - 1) / 2 || 1;
		return Array.from({ length: bars }, (_, i) => {
			const distance = Math.abs(i - mid) / mid;
			return 0.35 + 0.65 * (1 - distance) ** 1.15;
		});
	});

	function barHeight(envelope: number): number {
		return minPx + envelope * level * (maxPx - minPx);
	}
</script>

<div class={cn('flex items-center gap-[3px]', className)} aria-hidden="true">
	{#each ENVELOPE as envelope, i (i)}
		<!-- Height is set inline from the live mic level; the transition glides
		     between samples (~20-30 Hz) so the meter looks continuous, and is
		     dropped under reduced motion. -->
		<span
			class={cn(
				'w-[3px] rounded-full bg-white/80 transition-[height] duration-[80ms] ease-linear motion-reduce:transition-none',
				barClass,
			)}
			style="height: {barHeight(envelope)}px"
		></span>
	{/each}
</div>
