<script lang="ts" module>
	import { m } from '$lib/paraglide/messages';
	import { defineErrors } from 'wellcrafted/error';

	/**
	 * The reposition session runs on window verbs the overlay's Tauri capability
	 * has to grant one by one, so a denied permission shows up here as a rejected
	 * promise rather than a visible failure. Logged rather than swallowed: a
	 * silent no-op is exactly what a missing capability looked like the first
	 * time, and it cost a live debugging session to find.
	 */
	const RecordingOverlayPageError = defineErrors({
		RepositionFailed: ({ cause }: { cause: unknown }) => ({
			message: m.recording_overlay_recording_overlay_reposition_step(),
			cause,
		}),
	});
</script>

<script lang="ts">
	import type { UnlistenFn } from '@tauri-apps/api/event';
	import {
		currentMonitor,
		getCurrentWindow,
		LogicalPosition,
		LogicalSize,
	} from '@tauri-apps/api/window';
	import { onDestroy, onMount } from 'svelte';
	import { createLogger } from 'wellcrafted/logger';
	import {
		DEFAULT_OVERLAY_ANCHOR,
		formatAnchorLabel,
		guideLineOffsets,
		type LogicalRect,
		type OverlayAnchor,
		resolveAnchorPosition,
		snapRectToAnchor,
	} from '$lib/recording-overlay/anchor-position';
	import {
		OVERLAY_HEIGHT,
		OVERLAY_WIDTH,
	} from '$lib/recording-overlay/constants';
	import {
		type OverlayRepositionResult,
		recordingOverlayAction,
		recordingOverlayCancelReposition,
		recordingOverlayEnterReposition,
		recordingOverlayMicLevel,
		recordingOverlayReady,
		recordingOverlayRepositionResult,
		recordingOverlayStatus,
		revealMainWindow,
	} from '$lib/recording-overlay/events';
	import { foldMicLevel } from '$lib/recording-pill/level';
	import type {
		RecordingPillAction,
		RecordingPillStatus,
	} from '$lib/recording-pill/model';
	import RecordingPill from '$lib/recording-pill/RecordingPill.svelte';
	import RecordingPillReposition from '$lib/recording-pill/RecordingPillReposition.svelte';

	// Tauri adapter for the recording pill. The overlay lives in its own webview,
	// so it cannot read the recorder state modules directly: the main window
	// pushes the current status over a Tauri event and we render from that, and
	// control gestures go back over Tauri events. The pill itself
	// (`RecordingPill`) is platform-free; this route owns the IPC glue.
	let status = $state.raw<RecordingPillStatus | null>(null);

	// Live, smoothed mic loudness, 0 (silent) to 1 (loud). Driven by the
	// `mic-level` event: VAD frames in JS for voice-activated capture, the Rust
	// CPAL worker for manual recording. Both send a raw RMS amplitude; we apply
	// the perceptual curve and smoothing (shared with the web pill) so the bars
	// react to the actual voice rather than looping on a timer.
	let level = $state(0);

	const log = createLogger('tironian/recording-overlay-page');

	/** Run one reposition step, reporting a denied window verb instead of hiding it. */
	function runRepositionStep(step: Promise<void>): void {
		void step.catch((cause) => {
			log.warn(RecordingOverlayPageError.RepositionFailed({ cause }));
		});
	}

	const unlisteners: UnlistenFn[] = [];
	let isDestroyed = false;
	const trackUnlistener = (unlisten: UnlistenFn) => {
		if (isDestroyed) unlisten();
		else unlisteners.push(unlisten);
	};

	// ── Reposition session ──────────────────────────────────────────────────
	//
	// For the length of a session this window stops being a 300x72 chip and
	// becomes the whole work area, with the pill drawn inside it as an ordinary
	// absolutely positioned element. That is what makes guide lines possible at
	// all: a chip-sized window cannot paint a line across the screen, and the
	// only alternative was a second monitor-sized window to draw them in.
	//
	// It also makes the drag exact. Dragging the OS window means `startDragging`,
	// which hands control to the platform move loop and reports nothing back when
	// it ends, so the placement had to be inferred from window-move events and a
	// settle timer. Inside one webview it is just pointer capture: pointerdown,
	// pointermove, pointerup, with the snapped position rendered on every move so
	// the pill visibly locks into place under the cursor.

	const OVERLAY_SIZE = { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT };

	type RepositionSession = {
		/** Work area origin in screen logical px. The window sits exactly here. */
		origin: { x: number; y: number };
		/** The work area in window-local coordinates, so its origin is 0,0. */
		area: LogicalRect;
	};

	let session = $state.raw<RepositionSession | null>(null);
	let startingAnchor = $state.raw<OverlayAnchor>(DEFAULT_OVERLAY_ANCHOR);
	let pendingAnchor = $state.raw<OverlayAnchor>(DEFAULT_OVERLAY_ANCHOR);
	let xSnapped = $state(false);
	let ySnapped = $state(false);
	/** Where in the pill the drag was grabbed, so it does not jump to the cursor. */
	let grabOffset: { x: number; y: number } | null = null;

	const pillPosition = $derived(
		session
			? resolveAnchorPosition(pendingAnchor, session.area, OVERLAY_SIZE)
			: { x: 0, y: 0 },
	);
	const guides = $derived(
		guideLineOffsets(pendingAnchor, pillPosition, OVERLAY_SIZE),
	);

	function clamp(value: number, low: number, high: number): number {
		return Math.min(Math.max(value, low), high);
	}

	async function beginRepositioning(anchor: OverlayAnchor): Promise<void> {
		const monitor = await currentMonitor();
		if (!monitor || isDestroyed) return;

		const scale = monitor.scaleFactor;
		const origin = {
			x: monitor.workArea.position.x / scale,
			y: monitor.workArea.position.y / scale,
		};
		const area: LogicalRect = {
			x: 0,
			y: 0,
			width: monitor.workArea.size.width / scale,
			height: monitor.workArea.size.height / scale,
		};

		startingAnchor = anchor;
		pendingAnchor = anchor;
		// The stored anchor may be a free margin, so ask rather than assume.
		const start = resolveAnchorPosition(anchor, area, OVERLAY_SIZE);
		const opening = snapRectToAnchor({ ...start, ...OVERLAY_SIZE }, area);
		xSnapped = opening.xSnapped;
		ySnapped = opening.ySnapped;

		const overlayWindow = getCurrentWindow();
		await overlayWindow.setPosition(new LogicalPosition(origin.x, origin.y));
		await overlayWindow.setSize(new LogicalSize(area.width, area.height));
		session = { origin, area };
	}

	/**
	 * Shrink back to a chip at `restoreTo`, then report the outcome.
	 *
	 * The report goes out in a `finally` because the main window is awaiting it:
	 * a window verb that fails here must not leave that session hanging forever.
	 */
	async function finishSession(
		result: OverlayRepositionResult,
		restoreTo: OverlayAnchor,
	): Promise<void> {
		const ending = session;
		session = null;
		grabOffset = null;
		try {
			if (!ending) return;
			const overlayWindow = getCurrentWindow();
			await overlayWindow.setSize(
				new LogicalSize(OVERLAY_WIDTH, OVERLAY_HEIGHT),
			);
			const { x, y } = resolveAnchorPosition(
				restoreTo,
				{ ...ending.area, x: ending.origin.x, y: ending.origin.y },
				OVERLAY_SIZE,
			);
			await overlayWindow.setPosition(new LogicalPosition(x, y));
		} finally {
			await recordingOverlayRepositionResult.emit(result);
		}
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!session) return;
		const slot = event.currentTarget as HTMLElement;
		slot.setPointerCapture(event.pointerId);
		grabOffset = {
			x: event.clientX - pillPosition.x,
			y: event.clientY - pillPosition.y,
		};
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent): void {
		const active = session;
		const grab = grabOffset;
		if (!active || !grab) return;
		const snap = snapRectToAnchor(
			{
				x: clamp(event.clientX - grab.x, 0, active.area.width - OVERLAY_WIDTH),
				y: clamp(event.clientY - grab.y, 0, active.area.height - OVERLAY_HEIGHT),
				...OVERLAY_SIZE,
			},
			active.area,
		);
		pendingAnchor = snap.anchor;
		xSnapped = snap.xSnapped;
		ySnapped = snap.ySnapped;
	}

	function handlePointerUp(event: PointerEvent): void {
		grabOffset = null;
		const slot = event.currentTarget as HTMLElement;
		if (slot.hasPointerCapture(event.pointerId)) {
			slot.releasePointerCapture(event.pointerId);
		}
	}

	/**
	 * A press on the backdrop leaves the session.
	 *
	 * The session covers the screen and takes its clicks, so the way out has to
	 * live inside it: a control drawn anywhere else cannot be reached while it
	 * runs. Cancelling rather than saving because a stray press is far likelier
	 * than a deliberate one, and cancel is the outcome that loses nothing.
	 */
	function handleBackdropPointerDown(event: PointerEvent): void {
		// Only a press on the surface itself. Presses inside the pill bubble up
		// here too, and those are a drag starting, not a request to leave.
		if (event.target !== event.currentTarget) return;
		runRepositionStep(finishSession({ type: 'cancel' }, startingAnchor));
	}

	onMount(() => {
		void (async () => {
			trackUnlistener(
				await recordingOverlayStatus.listen((event) => {
					status = event.payload;
				}),
			);
			trackUnlistener(
				await recordingOverlayMicLevel.listen((event) => {
					level = foldMicLevel(level, event.payload);
				}),
			);
			trackUnlistener(
				await recordingOverlayEnterReposition.listen((event) => {
					runRepositionStep(beginRepositioning(event.payload.anchor));
				}),
			);
			// Settings can end a session too, for when this window's own controls
			// cannot be reached. Same path as the pill's own cancel button.
			trackUnlistener(
				await recordingOverlayCancelReposition.listen(() => {
					runRepositionStep(
						finishSession({ type: 'cancel' }, startingAnchor),
					);
				}),
			);
			// Tell the main window we are ready so it re-sends the latest status.
			// Without this handshake the status emitted right after window creation
			// can land before our listener is attached.
			if (!isDestroyed) await recordingOverlayReady.emit();
		})();
	});

	onDestroy(() => {
		isDestroyed = true;
		for (const unlisten of unlisteners) unlisten();
	});

	function sendAction(action: RecordingPillAction) {
		void recordingOverlayAction.emit(action);
	}
</script>

{#if session}
	<!-- For the length of the session this window IS the work area, so these
	     coordinates are both CSS pixels and the logical pixels the anchor math
	     speaks in. Nothing here converts between the two. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="reposition-surface" onpointerdown={handleBackdropPointerDown}>
		{#if xSnapped}
			<div class="guide guide-vertical" style="left: {guides.x}px"></div>
		{/if}
		{#if ySnapped}
			<div class="guide guide-horizontal" style="top: {guides.y}px"></div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="pill-slot"
			style="left: {pillPosition.x}px; top: {pillPosition.y}px; width: {OVERLAY_WIDTH}px; height: {OVERLAY_HEIGHT}px;"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		>
			<RecordingPillReposition
				label={formatAnchorLabel(pendingAnchor)}
				locked={xSnapped && ySnapped}
				onSave={() =>
					runRepositionStep(
						finishSession(
							{ type: 'save', anchor: pendingAnchor },
							pendingAnchor,
						),
					)}
				onReset={() =>
					runRepositionStep(
						finishSession(
							{ type: 'save', anchor: DEFAULT_OVERLAY_ANCHOR },
							DEFAULT_OVERLAY_ANCHOR,
						),
					)}
				onCancel={() =>
					runRepositionStep(finishSession({ type: 'cancel' }, startingAnchor))}
			/>
		</div>

		<p class="reposition-hint">
			{m.recording_overlay_drag_the_pill_where_you_want_it()}
		</p>
	</div>
{:else}
	<!-- The pill hugs its content, so center it within the fixed overlay window (the
	     web host centers its own copy). A fixed full-window flex box centers the chip
	     regardless of how the layout nests the route. -->
	<div class="fixed inset-0 flex items-center justify-center">
		<RecordingPill
			{status}
			{level}
			onStop={() => sendAction('stop')}
			onCancel={() => sendAction('cancel')}
			onShipRaw={() => sendAction('ship-raw')}
			onReveal={() => void revealMainWindow.emit()}
		/>
	</div>
{/if}

<style>
	/* A light scrim, so a session reads as a placement mode rather than a pill
	   that happened to grow. Light enough to keep the desktop underneath legible
	   while you decide where the pill belongs. */
	.reposition-surface {
		position: fixed;
		inset: 0;
		background: rgba(8, 8, 10, 0.22);
	}

	/* The only instruction on screen, so it sits where the eye lands first and
	   never under the pill, wherever the pill has been dragged to. */
	.reposition-hint {
		position: absolute;
		top: 24px;
		left: 0;
		right: 0;
		margin: 0;
		text-align: center;
		font-size: 12px;
		letter-spacing: 0.01em;
		color: rgba(255, 255, 255, 0.72);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
		pointer-events: none;
	}

	.pill-slot {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: grab;
		/* Pointer capture only behaves if the browser is not also panning. */
		touch-action: none;
	}

	.pill-slot:active {
		cursor: grabbing;
	}

	/* Drawn only while the matching axis is locked, so the line appearing IS the
	   confirmation that the placement is exact. No transition: a guide that fades
	   in reads as "nearly aligned", which is the opposite of what it means. */
	.guide {
		position: absolute;
		background: #faa2ca;
		box-shadow: 0 0 6px rgba(250, 162, 202, 0.9);
		pointer-events: none;
	}

	.guide-vertical {
		top: 0;
		bottom: 0;
		width: 1px;
		transform: translateX(-0.5px);
	}

	.guide-horizontal {
		left: 0;
		right: 0;
		height: 1px;
		transform: translateY(-0.5px);
	}

	/* The document-level resets below stay as `:global` CSS: a component cannot
	   apply utilities to `html`/`body` or to the dev-injected inspector host, so
	   these have no Tailwind equivalent. They belong to the overlay webview, not the
	   pill: they are only ever loaded in the dedicated overlay Tauri window, which
	   has its own document. The main app window never navigates here, so its
	   document background is untouched. (The isolation comes from the separate
	   webview document, not from Svelte's component scoping.) The shared
	   `RecordingPill` keeps no document-level styles so it can also mount inside the
	   app on web. */
	:global(html),
	:global(body) {
		background: transparent !important;
		margin: 0;
		overflow: hidden;
		/* The app shell forces a dark theme (ModeWatcher sets color-scheme:dark),
		   which makes the browser paint a dark canvas behind the pill in this
		   transparent webview. Reset it so only the pill is visible. */
		color-scheme: normal !important;
	}

	/* The Svelte inspector toggle (svelte.config.js `showToggleButton: always`)
	   is injected into every dev document, including this overlay webview where
	   it overlaps the pill. Hide it here; this rule lives only in the overlay
	   webview's document, and the host element does not exist in production. */
	:global(#svelte-inspector-host) {
		display: none !important;
	}
</style>
