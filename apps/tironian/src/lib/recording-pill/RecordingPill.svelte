<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '@tironian/ui/utils';
	import SquareIcon from '@lucide/svelte/icons/square';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { DICTATION_FAILURE_LABEL } from '$lib/dictation-feedback';
	import LevelMeter from '$lib/recording-pill/LevelMeter.svelte';
	import type { RecordingPillStatus } from '$lib/recording-pill/model';
	import VadIndicator from '$lib/recording-pill/VadIndicator.svelte';

	// The floating dictation pill, presentational and platform-free. It renders
	// whatever status it is handed and reports control gestures through callback
	// props; it never reads recorder state or touches Tauri. The Tauri build
	// drives it over IPC from a dedicated overlay webview.
	//
	// Visual language is Vivavoce 4a, with the options the design marks chosen:
	// idle is a flat line that dims after 4s; listening is five bars riding the
	// real mic level, never a loop; processing is P1, the mark passing slowly
	// along the line like a note; delivered is D1, a green check held for 1.2s.
	// One adaptation: the artboards scroll a waveform stroke, which the brand
	// rejects (docs/brand/tironian.md, "The mark stays U+204A"). P1's own words
	// are "come una nota che passa", so it passes a musical note along the line,
	// taken literally at Nicola's request. The design
	// has no controls and no text; stop, cancel and ship-raw appear on hover so
	// the resting pill stays the glyph alone, and the withheld and failed states
	// the design does not draw keep their words in the same shell.
	let {
		status,
		level,
		onStop,
		onCancel,
		onShipRaw,
		onReveal,
	}: {
		/** What to display, or `null` for the resting line. */
		status: RecordingPillStatus | null;
		/** Live, smoothed mic loudness, 0 (silent) to 1 (loud). */
		level: number;
		/** Stop the live capture (stop recording / stop listening). */
		onStop: () => void;
		/** Discard the live manual recording. */
		onCancel: () => void;
		/** Skip the in-flight Polish pass and deliver the raw transcript now. */
		onShipRaw: () => void;
		/** Reveal Tironian by raising the main window (desktop). */
		onReveal?: () => void;
	} = $props();

	const recording = $derived(
		status?.phase === 'recording' ? status : null,
	);
	const processing = $derived(
		status?.phase === 'transcribing' || status?.phase === 'polishing',
	);
	// A VAD session lights its bars only once speech latches; loudness alone
	// (a door, a fan) keeps them dim, so the meter says "heard you", not "noise".
	const lit = $derived(
		!recording || recording.trigger === 'manual' || recording.isSpeaking,
	);

	// Read by screen readers only: the pill shows the glyph, the label says it.
	const deliveredLabel = $derived.by(() => {
		if (status?.phase !== 'delivered') return '';
		const { wordCount, reach } = status;
		const wordsLabel =
			wordCount != null
				? `${wordCount} word${wordCount === 1 ? '' : 's'}`
				: 'Delivered';
		return reach === 'clipboard' ? `${wordsLabel} · Clipboard` : wordsLabel;
	});

	const actionBase =
		'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-[#c7c2ba] transition duration-150 ease-out hover:bg-white/20 hover:text-white active:scale-95';
</script>

<!-- The desktop pill lives in a non-focusable overlay window. Clicking its body
     asks the main window to reveal itself; the nested controls stop propagation
     so stop, cancel, and ship-raw never reveal it as a side effect. At rest the
     window passes clicks through, so the line never takes one. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(
		'vv-pill group box-border flex items-center gap-2.5 rounded-full select-none',
		status ? 'h-[34px] px-4' : 'vv-pill--idle h-[30px] px-3.5',
		(status?.phase === 'failed' || status?.phase === 'withheld') &&
			'vv-pill--warn',
		onReveal && status && 'cursor-pointer',
	)}
	title={onReveal && status ? 'Open Tironian' : undefined}
	onclick={onReveal}
>
	{#if !status}
		<svg
			width="22"
			height="14"
			viewBox="0 0 24 14"
			fill="none"
			stroke="#8f8a82"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"><path d="M2 7h20"></path></svg
		>
	{:else if recording}
		{@const stopLabel =
			recording.trigger === 'manual' ? 'Stop recording' : 'Stop listening'}
		<LevelMeter
			{level}
			bars={5}
			minPx={4}
			maxPx={18}
			class={cn(
				'h-[18px] gap-[2.5px] transition-opacity duration-200',
				!lit && 'opacity-45',
			)}
			barClass="w-[2.5px] bg-[#d97757] [&:nth-child(3)]:bg-[#e8906f] [&:nth-child(5)]:bg-[#e8906f]"
		/>

		<div class="hidden items-center gap-1 group-hover:flex">
			{#if recording.trigger === 'manual'}
				<button
					type="button"
					class={actionBase}
					aria-label={m.commands_cancel_recording()}
					title={m.commands_cancel_recording()}
					onclick={(event) => {
						event.stopPropagation();
						onCancel();
					}}
				>
					<XIcon class="size-3" />
				</button>
			{:else}
				<!-- VAD has no per-utterance cancel, so the slot shows whether a
				     previous phrase is still transcribing. -->
				<div class="flex size-5 items-center justify-center">
					<VadIndicator signals={recording} />
				</div>
			{/if}
			<button
				type="button"
				class={cn(actionBase, 'bg-[#d97757]/70 text-white hover:bg-[#d97757]')}
				aria-label={stopLabel}
				title={stopLabel}
				onclick={(event) => {
					event.stopPropagation();
					onStop();
				}}
			>
				<SquareIcon class="size-2.5" />
			</button>
		</div>
	{:else if processing}
		<!-- P1, taken literally: an eighth note (♪) passes slowly left to right,
		     alone, with no line under it (Nicola's call). Drawn as geometry
		     rather than set as U+266A, which some Windows fonts turn into a
		     color emoji. The group is nudged down so the note sits centred. -->
		<svg
			width="22"
			height="14"
			viewBox="0 0 22 14"
			fill="none"
			aria-hidden="true"
		>
			<g class="vv-mark" transform="translate(0 1.3)">
				<ellipse
					cx="2.4"
					cy="8.6"
					rx="2.3"
					ry="1.7"
					transform="rotate(-20 2.4 8.6)"
					fill="#c7c2ba"
				></ellipse>
				<path
					d="M4.5 8.2V1.2"
					stroke="#c7c2ba"
					stroke-width="1.2"
					stroke-linecap="round"
				></path>
				<path
					d="M4.5 1.2c1.9 0.8 3.1 2.1 2.7 4.3"
					stroke="#c7c2ba"
					stroke-width="1.2"
					stroke-linecap="round"
				></path>
			</g>
		</svg>
		<span class="sr-only">{m.recording_pill_flowing()}</span>
		{#if status?.phase === 'polishing'}
			<button
				type="button"
				class={cn(actionBase, 'hidden group-hover:flex')}
				aria-label={m.recording_pill_ship_raw_transcript_now()}
				title={m.recording_pill_ship_raw_transcript_now()}
				onclick={(event) => {
					event.stopPropagation();
					onShipRaw();
				}}
			>
				<XIcon class="size-3" />
			</button>
		{/if}
	{:else if status.phase === 'delivered'}
		<!-- D1. A clipboard reach keeps the amber signal the lifecycle already
		     gives it (ADR-0039): the text landed somewhere other than the cursor,
		     so the pill says where, and it stays until the next dictation. -->
		<svg
			width="16"
			height="14"
			viewBox="0 0 16 14"
			fill="none"
			stroke={status.reach === 'clipboard' ? '#d9a55b' : '#7da878'}
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M2 8l4 4 8-9"></path></svg
		>
		{#if status.reach === 'clipboard'}
			<span class="text-[12.5px] text-[#c7c2ba]">Clipboard</span>
		{/if}
		<span class="sr-only">{deliveredLabel}</span>
	{:else if status.phase === 'withheld'}
		<!-- The secure-field guard refused the configured output, so the
		     transcript went only to history. Amber, and it persists, because no
		     landed text corroborates this outcome. -->
		<TriangleAlertIcon class="size-3.5 shrink-0 text-[#d9a55b]" />
		<span class="max-w-52 truncate text-[12.5px] text-[#c7c2ba]"
			>{m.recording_pill_kept_in_history_secure_field()}</span
		>
	{:else if status.phase === 'failed'}
		<TriangleAlertIcon class="size-3.5 shrink-0 text-[#d9a55b]" />
		<span class="max-w-52 truncate text-[12.5px] text-[#c7c2ba]"
			>{DICTATION_FAILURE_LABEL[status.tier]}</span
		>
	{/if}
</div>

<style>
	/* Vivavoce 4a's shell: the warm near-black capsule, a hairline border and a
	   deep soft shadow. Kept here rather than in utilities because the overlay
	   webview paints nothing else, so the pill carries its whole material. */
	.vv-pill {
		background: #211f1c;
		border: 1px solid rgba(255, 252, 245, 0.14);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		color: #c7c2ba;
		transition:
			opacity 300ms ease,
			border-color 200ms ease;
	}

	/* At rest the line dims to 60% after 4s: present, never loud. The class is
	   re-added on every return to rest, which restarts the delay. */
	.vv-pill--idle {
		border-color: rgba(255, 252, 245, 0.1);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
		animation: vv-idle-dim 400ms ease 4s forwards;
	}
	@keyframes vv-idle-dim {
		to {
			opacity: 0.6;
		}
	}

	.vv-pill--warn {
		border-color: rgba(217, 165, 91, 0.45);
	}

	/* P1: one slow pass every 3s, entering left and leaving right. */
	.vv-mark {
		animation: vv-mark-pass 3s linear infinite;
	}
	@keyframes vv-mark-pass {
		from {
			transform: translateX(-7px);
		}
		to {
			transform: translateX(23px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.vv-pill {
			transition: none;
		}
		/* The 4s dim is a change of state, not motion, so it still happens;
		   it just lands in one step instead of fading. */
		.vv-pill--idle {
			animation: vv-idle-dim 1ms linear 4s forwards;
		}
		.vv-mark {
			animation: none;
			transform: translateX(8px);
		}
	}
</style>
