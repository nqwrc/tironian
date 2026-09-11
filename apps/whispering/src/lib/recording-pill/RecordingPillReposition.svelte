<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '@tironian/ui/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		label,
		locked,
		onSave,
		onReset,
		onCancel,
	}: {
		/** The currently resolved placement, e.g. "Bottom Center". */
		label: string;
		/** Both axes are on a canonical placement, so the guides are showing. */
		locked: boolean;
		onSave: () => void;
		onReset: () => void;
		onCancel: () => void;
	} = $props();

	const actionBase =
		'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/90 transition duration-150 ease-out hover:scale-[1.08] active:scale-95';

	/**
	 * A press on a button must not also start a drag. The drag listens on the
	 * slot this component sits in, and `pointerdown` is what starts it, so
	 * stopping that here is what keeps the three controls clickable at all.
	 */
	function keepPressLocal(event: PointerEvent) {
		event.stopPropagation();
	}
</script>

<div
	class={cn(
		'wispr-pill-reposition box-border flex w-[260px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-white/90 select-none',
		locked && 'wispr-pill-reposition--locked',
	)}
>
	<span class="truncate text-[12px] font-medium tracking-tight text-white/85">
		{label}
	</span>
	<div class="flex items-center gap-1.5">
		<button
			type="button"
			class={cn(
				actionBase,
				'bg-emerald-500/70 text-white hover:bg-emerald-500/90',
			)}
			aria-label={m.recording_pill_reposition_save_position()}
			title={m.recording_pill_reposition_save_position()}
			onpointerdown={keepPressLocal}
			onclick={onSave}
		>
			<CheckIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class={cn(actionBase, 'hover:bg-white/20')}
			aria-label={m.recording_pill_reposition_reset_to_default_position()}
			title={m.recording_pill_reposition_reset_to_default_position()}
			onpointerdown={keepPressLocal}
			onclick={onReset}
		>
			<RotateCcwIcon class="size-3.5" />
		</button>
		<button
			type="button"
			class={cn(actionBase, 'hover:bg-[#faa2ca]/20 hover:text-[#ffd2e4]')}
			aria-label={m.recording_pill_reposition_cancel()}
			title={m.recording_pill_reposition_cancel()}
			onpointerdown={keepPressLocal}
			onclick={onCancel}
		>
			<XIcon class="size-3.5" />
		</button>
	</div>
</div>

<style>
	/* The same material as `.wispr-pill` in RecordingPill.svelte, declared
	   separately rather than shared: that component's class also carries the
	   width/height transition its phase changes animate, which a static
	   placement preview has nothing to do with. */
	.wispr-pill-reposition {
		background: rgba(18, 18, 20, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.45),
			0 2px 6px rgba(0, 0, 0, 0.3);
		transition:
			border-color 90ms ease-out,
			box-shadow 90ms ease-out;
	}

	/* Locked onto a canonical placement. The same accent the guide lines use, so
	   the pill and the lines read as one state rather than two signals. */
	.wispr-pill-reposition--locked {
		border-color: rgba(250, 162, 202, 0.85);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.45),
			0 0 0 1px rgba(250, 162, 202, 0.35),
			0 0 18px rgba(250, 162, 202, 0.25);
	}
</style>
