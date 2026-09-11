<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '@tironian/ui/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MicOffIcon from '@lucide/svelte/icons/mic-off';
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
	// drives it over IPC from a dedicated overlay webview; the web build would
	// mount it directly in the app layout. Both feed the same `status` and
	// `level`. Visual language follows the Wispr Flow floating-pill spec
	// (`research/01_wispr_flow_spec.md` §2, `research/03_design_tokens.md`,
	// `research/06_live_widget_and_settings_spec.md` §1): a glassmorphic capsule
	// that resizes per phase rather than a fixed-width chip bar.
	let {
		status,
		level,
		onStop,
		onCancel,
		onShipRaw,
		onReveal,
	}: {
		/** What to display, or `null` when the dictation is idle. */
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

	// Narrow the status to its live-recording variant once, so the template
	// reads the discriminated fields directly (manual vs vad, speech latched, a
	// previous phrase transcribing) instead of a flattened bag of booleans.
	const recording = $derived(
		status?.phase === 'recording' ? status : null,
	);
	const isRecording = $derived(status?.phase === 'recording');

	// mm:ss elapsed timer, local to the pill and driven off `isRecording` alone
	// (not the whole `status` object) so a VAD session's frequent status
	// updates (speech latching on and off) do not reset it mid-listen; only a
	// transition into or out of `recording` restarts the interval.
	let elapsedSeconds = $state(0);
	$effect(() => {
		if (!isRecording) {
			elapsedSeconds = 0;
			return;
		}
		elapsedSeconds = 0;
		const interval = setInterval(() => {
			elapsedSeconds += 1;
		}, 1000);
		return () => clearInterval(interval);
	});
	const timerLabel = $derived.by(() => {
		const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
		const seconds = String(elapsedSeconds % 60).padStart(2, '0');
		return `${minutes}:${seconds}`;
	});

	// Pixel dimensions per phase (design tokens: idle 120x36, listening 260x44,
	// processing 190x44, delivered 200x44, error 220x44). The container
	// transitions between them (see `.wispr-pill` below) so a phase change reads
	// as the pill breathing, not a hard cut. Keep in sync with `OVERLAY_WIDTH` /
	// `OVERLAY_HEIGHT` in the desktop overlay's window manager, which must be
	// large enough to host the widest state plus shadow/glow bleed.
	const dims = $derived.by((): { w: number; h: number } => {
		if (!status) return { w: 120, h: 36 };
		switch (status.phase) {
			case 'recording':
				return { w: 260, h: 44 };
			case 'transcribing':
			case 'polishing':
				return { w: 190, h: 44 };
			case 'delivered':
				return { w: 200, h: 44 };
			case 'withheld':
			case 'failed':
				return { w: 220, h: 44 };
			default:
				status satisfies never;
				return { w: 120, h: 36 };
		}
	});

	// Recording spreads its content edge to edge (dot/timer left, controls
	// right); polishing spreads its label from the ship-raw control; every
	// other phase is a single centered cluster.
	const layoutJustify = $derived(
		isRecording || status?.phase === 'polishing'
			? 'justify-between'
			: 'justify-center',
	);

	// Delivered label: word count when the pipeline reported one (it always
	// does today; the field is optional so a future caller without text handy
	// degrades to a plain word), else "Delivered". A `clipboard` reach keeps the
	// amber, non-auto-clearing signal the source lifecycle already gives it
	// (ADR-0039): the text landed somewhere other than the cursor, which is
	// worth calling out beside the count rather than a silent green check.
	const deliveredLabel = $derived.by(() => {
		if (status?.phase !== 'delivered') return '';
		const { wordCount, reach } = status;
		const wordsLabel =
			wordCount != null ? `${wordCount} word${wordCount === 1 ? '' : 's'}` : 'Delivered';
		return reach === 'clipboard' ? `${wordsLabel} · Clipboard` : wordsLabel;
	});

	// Resting state is a filled chip, not a bare icon, so the controls read as
	// buttons at a glance in the small pill. Each control composes its own tone
	// over this shared base, which carries the hover/press feedback.
	const actionBase =
		'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/90 transition duration-150 ease-out hover:scale-[1.08] active:scale-95';
</script>

<!-- The desktop pill lives in a non-focusable overlay window. Clicking its body
     asks the main window to reveal itself; the nested controls stop propagation
     so stop, cancel, and ship-raw never reveal it as a side effect. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(
		'wispr-pill box-border flex items-center gap-2 rounded-full px-3 text-white/90 select-none',
		layoutJustify,
		status?.phase === 'failed' && 'wispr-pill--failed',
		onReveal && 'cursor-pointer',
	)}
	style="width: {dims.w}px; height: {dims.h}px;"
	title={onReveal ? 'Open Tironian' : undefined}
	onclick={onReveal}
>
	{#if !status}
		<!-- Idle: hidden by the desktop overlay window (it hides on a `null`
		     status), but drawn correctly here too in case a host ever mounts
		     the pill instead of hiding it. -->
		<MicOffIcon class="size-4 text-white/40" />
	{:else if recording}
		{@const stopLabel =
			recording.trigger === 'manual' ? 'Stop recording' : 'Stop listening'}
		<div class="flex items-center gap-1.5">
			<span class="rec-dot" aria-hidden="true"></span>
			<span class="font-mono text-[12px] text-white/85 tabular-nums"
				>{timerLabel}</span
			>
		</div>

		<!-- Reactive waveform: 7 bars, violet-to-indigo gradient, height driven by
		     the live mic level (`recordingOverlayMicLevel` on desktop). -->
		<LevelMeter
			{level}
			bars={7}
			minPx={4}
			maxPx={24}
			class="h-6 flex-1 justify-center"
			barClass="w-[3px] bg-gradient-to-t from-[#8B5CF6] to-[#6366F1]"
		/>

		<!-- Trailing cluster: a contextual slot, then stop as the constant right
		     anchor. Manual and VAD share this skeleton (slot then stop), so the
		     meter and the stop button land in the same place in both modes and
		     only the slot's content differs. -->
		<div class="flex items-center gap-1">
			{#if recording.trigger === 'manual'}
				<!-- Manual can discard the take, so the slot is the cancel button. -->
				<button
					type="button"
					class={cn(actionBase, 'hover:bg-[#faa2ca]/20 hover:text-[#ffd2e4]')}
					aria-label={m.commands_cancel_recording()}
					title={m.commands_cancel_recording()}
					onclick={(event) => {
						event.stopPropagation();
						onCancel();
					}}
				>
					<XIcon class="size-4" />
				</button>
			{:else}
				<!-- VAD has no per-utterance cancel (`pill-actions.ts` treats it as a
				     no-op), so the slot holds the capture indicator at the cancel
				     button's width instead, keeping the cluster balanced. -->
				<div class="flex size-6 items-center justify-center">
					<VadIndicator signals={recording} />
				</div>
			{/if}

			<button
				type="button"
				class={cn(actionBase, 'bg-red-500/70 text-white hover:bg-red-500/90')}
				aria-label={stopLabel}
				title={stopLabel}
				onclick={(event) => {
					event.stopPropagation();
					onStop();
				}}
			>
				<SquareIcon class="size-3.5" />
			</button>
		</div>
	{:else if status.phase === 'transcribing' || status.phase === 'polishing'}
		<!-- Processing: shimmering bar + "Flowing…" label mask the ASR and Polish
		     passes. Polishing alone carries a control (ADR-0099): a small X skips
		     the in-flight Polish pass and ships the raw transcript now. -->
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="shimmer-bar" aria-hidden="true"></span>
			<span class="truncate text-[13px] font-medium tracking-tight text-white/90"
				>{m.recording_pill_flowing()}</span
			>
		</div>
		{#if status.phase === 'polishing'}
			<button
				type="button"
				class={cn(actionBase, 'hover:bg-[#faa2ca]/20 hover:text-[#ffd2e4]')}
				aria-label={m.recording_pill_ship_raw_transcript_now()}
				title={m.recording_pill_ship_raw_transcript_now()}
				onclick={(event) => {
					event.stopPropagation();
					onShipRaw();
				}}
			>
				<XIcon class="size-4" />
			</button>
		{/if}
	{:else if status.phase === 'delivered'}
		<CheckIcon
			class={cn(
				'size-4 shrink-0',
				status.reach === 'clipboard' ? 'text-amber-400' : 'text-[#10B981]',
			)}
		/>
		<span class="min-w-0 truncate text-[13px] font-medium tracking-tight text-white/90"
			>{deliveredLabel}</span
		>
	{:else if status.phase === 'withheld'}
		<!-- The secure-field guard refused the configured output: a password field
		     had focus at paste time, so the transcript went only to history.
		     Amber like a reduced reach, and it persists the same way, because no
		     landed text corroborates this outcome. -->
		<TriangleAlertIcon class="size-4 shrink-0 text-amber-400" />
		<span class="min-w-0 truncate text-[13px] font-medium tracking-tight text-white/90"
			>{m.recording_pill_kept_in_history_secure_field()}</span
		>
	{:else if status.phase === 'failed'}
		<TriangleAlertIcon class="size-4 shrink-0 text-amber-400" />
		<span class="min-w-0 truncate text-[13px] font-medium tracking-tight text-white/90"
			>{DICTATION_FAILURE_LABEL[status.tier]}</span
		>
	{/if}
</div>

<style>
	/* The glassmorphic capsule shell. Tailwind covers layout and per-state
	   colors above; the material (blur+saturate backdrop filter, the deep drop
	   shadow, and the width/height glide between phases) lives here because
	   Tailwind's filter utilities do not compose a `blur() saturate()` backdrop
	   filter as directly as a single declaration does. */
	.wispr-pill {
		background: rgba(18, 18, 20, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.45),
			0 2px 6px rgba(0, 0, 0, 0.3);
		transition:
			width 200ms ease-out,
			height 200ms ease-out,
			border-color 200ms ease-out;
	}

	.wispr-pill--failed {
		border-color: rgba(251, 191, 36, 0.4);
	}

	/* Recording indicator: a breathing dot with a soft radial halo behind it,
	   both looping continuously while listening. The halo is a pseudo-element
	   so it can bleed past the dot's own box without affecting layout. */
	.rec-dot {
		position: relative;
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 9999px;
		background: #ef4444;
		animation: rec-dot-breathe 1.6s ease-in-out infinite;
	}
	.rec-dot::after {
		content: '';
		position: absolute;
		inset: -7px;
		border-radius: 9999px;
		background: radial-gradient(circle, rgba(239, 68, 68, 0.55), transparent 70%);
		animation: rec-dot-glow 1.6s ease-in-out infinite;
	}
	@keyframes rec-dot-breathe {
		0%,
		100% {
			opacity: 0.65;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}
	@keyframes rec-dot-glow {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 0.8;
		}
	}

	/* Processing: a thin track with a violet-to-indigo highlight sweeping
	   across it, standing in for the ASR/Polish pass's indeterminate progress. */
	.shimmer-bar {
		position: relative;
		display: block;
		width: 56px;
		height: 4px;
		flex-shrink: 0;
		border-radius: 9999px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.1);
	}
	.shimmer-bar::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, #8b5cf6, #6366f1, transparent);
		background-size: 200% 100%;
		animation: shimmer-sweep 1.4s linear infinite;
	}
	@keyframes shimmer-sweep {
		from {
			background-position: 150% 0;
		}
		to {
			background-position: -50% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wispr-pill {
			transition: none;
		}
		.rec-dot,
		.rec-dot::after,
		.shimmer-bar::after {
			animation: none;
		}
	}
</style>
