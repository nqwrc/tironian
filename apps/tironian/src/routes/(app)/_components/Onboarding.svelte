<script lang="ts">
	import '@fontsource/newsreader/400-italic.css';
	import { goto } from '$app/navigation';
	import MicIcon from '@lucide/svelte/icons/mic';
	import { PRODUCT_NAME } from '$lib/constants/brand';
	import { m } from '$lib/paraglide/messages';
	import { os } from '#platform/os';
	import { createSystemShortcuts } from '#platform/system-shortcuts';
	import { tauri } from '#platform/tauri';
	import { getTironianApp } from '$lib/app/context';
	import { dictationPath } from '$lib/constants/urls';
	import { createFocusedShortcuts } from '$lib/platform/focused-shortcuts';
	import { recordingOverlayMicLevel } from '$lib/recording-overlay/events';
	import { foldMicLevel } from '$lib/recording-pill/level';
	import { dispatchPillAction } from '$lib/recording-pill/pill-actions';
	import { projectLifecycleToStatus } from '$lib/recording-pill/projection';
	import RecordingPill from '$lib/recording-pill/RecordingPill.svelte';
	import { PROVIDERS } from '$lib/services/transcription/providers';
	import { getTranscriptionReadiness } from '$lib/settings/transcription-validation';
	import { deviceConfig } from '$lib/state/device-config.svelte';
	import { dictationLifecycle } from '$lib/state/dictation-lifecycle.svelte';
	import { keyBindingToLabel } from '$lib/utils/key-binding';

	// Vivavoce 4e: three light steps on first run, over the app. Welcome, the
	// microphone, then a real try with the pill and the words it produced. The
	// light theme is this screen's own: it paints the design's warm paper
	// colors directly rather than flipping the app theme, which stays dark.
	//
	// The copy follows the setup rather than the artboards. "Never leaves your
	// computer" is only true on-device, so a cloud route names where audio goes,
	// and recordings are kept in history, not discarded, so the microphone step
	// says that instead.
	const app = getTironianApp();

	const open = $derived(!deviceConfig.get('onboarding.completed'));
	let step = $state<0 | 1 | 2>(0);

	const service = $derived(app.settings.get('transcriptionService'));
	const local = $derived(service === 'local');
	const provider = $derived(PROVIDERS[service].label);

	// ── Microphone ────────────────────────────────────────────────────
	let mic = $state<'unknown' | 'ready' | 'blocked'>('unknown');

	$effect(() => {
		if (!open || step !== 1 || !tauri) return;
		void tauri.permissions.microphone.check().then(({ data }) => {
			if (data) mic = 'ready';
		});
	});

	async function allowMicrophone() {
		if (!tauri) return startTry();
		const { data } = await tauri.permissions.microphone.request();
		if (data) {
			mic = 'ready';
			startTry();
		} else {
			mic = 'blocked';
		}
	}

	// ── Try ───────────────────────────────────────────────────────────
	// The push-to-talk hold leads, like the Home chip; toggle is the fallback.
	const shortcuts = createSystemShortcuts?.(app) ?? createFocusedShortcuts(app);
	const labelOf = (id: 'pushToTalk' | 'toggleManualRecording') => {
		const binding = shortcuts.current(id);
		return binding ? keyBindingToLabel(binding, os.isApple, os.isWindows) : '';
	};
	const holdLabel = $derived(labelOf('pushToTalk'));
	const pressLabel = $derived(labelOf('toggleManualRecording'));

	const readiness = $derived(getTranscriptionReadiness(app));
	const pillStatus = $derived(projectLifecycleToStatus(dictationLifecycle.current));

	let tryStartedAt = $state(0);
	function startTry() {
		tryStartedAt = Date.now();
		step = 2;
	}
	// The newest recording made since this step opened, if any.
	const attempt = $derived(
		step === 2
			? app.recordings.sorted.find(
					(recording) =>
						new Date(recording.recordedAt).getTime() >= tryStartedAt - 1000,
				)
			: undefined,
	);
	const attemptText = $derived(
		attempt ? (attempt.polishedTranscript ?? attempt.transcript).trim() : '',
	);

	// The live mic level, for the pill's bars while trying.
	let level = $state(0);
	$effect(() => {
		if (!open || step !== 2 || !tauri) return;
		let unlisten: (() => void) | undefined;
		let stopped = false;
		void recordingOverlayMicLevel
			.listen((event) => {
				level = foldMicLevel(level, event.payload);
			})
			.then((fn) => {
				if (stopped) fn();
				else unlisten = fn;
			});
		return () => {
			stopped = true;
			unlisten?.();
		};
	});

	function finish(path: `/${string}` = '/') {
		deviceConfig.set('onboarding.completed', true);
		void goto(dictationPath(path));
	}
</script>

{#if open}
	<div
		class="ob fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
	>
		<div
			class="flex w-full max-w-[400px] flex-col items-center gap-[22px] px-9 py-10 text-center"
		>
			{#if step === 0}
				<!-- U+204A as the app icon draws it: a bar and a stem falling from
				     its right end (docs/brand/icon/mark.ps1), in the accent. -->
				<svg
					viewBox="372 262 290 520"
					class="h-11"
					fill="#c65f3f"
					aria-hidden="true"
				>
					<rect x="372" y="262" width="290" height="96"></rect>
					<rect x="566" y="262" width="96" height="520"></rect>
				</svg>
				<h1 id="onboarding-title" class="ob-wordmark">{PRODUCT_NAME}</h1>
				<p class="ob-body">
					{local
						? m.onboarding_tagline_local()
						: m.onboarding_tagline_cloud({ provider })}
				</p>
				<button type="button" class="ob-primary" onclick={() => (step = 1)}>
					{m.onboarding_start()}
				</button>
			{:else if step === 1}
				<div class="ob-mic"><MicIcon class="size-8" strokeWidth={1.5} /></div>
				<h1 id="onboarding-title" class="ob-title">{m.onboarding_mic_title()}</h1>
				<p class="ob-body">
					{local
						? m.onboarding_mic_body_local()
						: m.onboarding_mic_body_cloud({ provider })}
				</p>
				{#if mic === 'ready'}
					<p class="ob-ok">{m.onboarding_mic_ready()}</p>
					<button type="button" class="ob-primary" onclick={startTry}>
						{m.onboarding_continue()}
					</button>
				{:else}
					<button type="button" class="ob-primary" onclick={allowMicrophone}>
						{m.onboarding_allow()}
					</button>
					{#if mic === 'blocked'}
						<p class="ob-warn">{m.onboarding_mic_blocked()}</p>
					{/if}
					<button type="button" class="ob-link" onclick={startTry}>
						{m.onboarding_later()}
					</button>
				{/if}
			{:else}
				<h1 id="onboarding-title" class="ob-title">{m.onboarding_try_title()}</h1>
				{#if !readiness.isReady}
					<p class="ob-body">{readiness.primaryIssue}</p>
					<button
						type="button"
						class="ob-primary"
						onclick={() => finish('/settings/processing')}
					>
						{m.transcription_selector_set_up_transcription()}
					</button>
				{:else}
					<p class="ob-body">
						{#if holdLabel}
							{m.onboarding_try_hold_before()}
							<kbd class="ob-kbd">{holdLabel}</kbd>
							{m.onboarding_try_hold_after()}
						{:else if pressLabel}
							{m.onboarding_try_press_before()}
							<kbd class="ob-kbd">{pressLabel}</kbd>
							{m.onboarding_try_press_after()}
						{:else}
							{m.onboarding_try_no_shortcut()}
						{/if}
					</p>
					<RecordingPill
						status={pillStatus}
						{level}
						onStop={() => void dispatchPillAction(app, 'stop')}
						onCancel={() => void dispatchPillAction(app, 'cancel')}
						onShipRaw={() => void dispatchPillAction(app, 'ship-raw')}
					/>
					<div class="ob-transcript" aria-live="polite">
						{#if attemptText}
							{attemptText}
						{:else if attempt?.transcriptionStatus === 'pending'}
							<span class="text-[#8f8a82]">{m.home_transcribing()}</span>
						{:else}
							<span class="text-[#8f8a82]">{m.onboarding_try_placeholder()}</span>
						{/if}<span class="ob-caret" aria-hidden="true"></span>
					</div>
				{/if}
				<button type="button" class="ob-link" onclick={() => finish()}>
					{m.onboarding_finish({ productName: PRODUCT_NAME })}
				</button>
			{/if}

			<div class="ob-dots" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<span class:active={i === step}></span>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Vivavoce 4e's paper: the one light surface in a dark app. */
	.ob {
		background: #faf8f5;
		color: #2e2b27;
		color-scheme: light;
	}
	.ob-wordmark {
		font-family: 'Newsreader', Georgia, serif;
		font-style: italic;
		font-weight: 400;
		font-size: 46px;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.ob-title {
		font-size: 22px;
		font-weight: 600;
	}
	.ob-body {
		font-size: 14.5px;
		color: #6d675e;
		line-height: 1.6;
		text-wrap: pretty;
	}
	.ob-primary {
		padding: 10px 24px;
		border-radius: 6px;
		background: #2e2b27;
		color: #faf8f5;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	.ob-primary:hover {
		background: #45403a;
	}
	.ob-primary:focus-visible,
	.ob-link:focus-visible {
		outline: 2px solid #c65f3f;
		outline-offset: 2px;
	}
	.ob-link {
		font-size: 12.5px;
		color: #8f8a82;
		cursor: pointer;
		border-radius: 4px;
	}
	.ob-link:hover {
		color: #2e2b27;
	}
	.ob-mic {
		display: flex;
		width: 84px;
		height: 84px;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: #fff;
		border: 1px solid #e5e1da;
	}
	.ob-ok {
		font-size: 12.5px;
		color: #5f8a5a;
	}
	.ob-warn {
		font-size: 12.5px;
		color: #a4532f;
		line-height: 1.5;
	}
	.ob-kbd {
		font-family: 'IBM Plex Mono', monospace;
		font-size: 12px;
		background: #fff;
		border: 1px solid #e5e1da;
		padding: 3px 9px;
		border-radius: 6px;
		color: #2e2b27;
		white-space: nowrap;
	}
	.ob-transcript {
		width: 100%;
		min-height: 64px;
		background: #fff;
		border: 1px solid #e5e1da;
		border-radius: 10px;
		padding: 14px;
		font-size: 13.5px;
		color: #57534c;
		line-height: 1.6;
		text-align: left;
	}
	.ob-caret {
		display: inline-block;
		width: 1.5px;
		height: 14px;
		margin-left: 2px;
		vertical-align: middle;
		background: #c65f3f;
		animation: ob-blink 1s steps(1) infinite;
	}
	@keyframes ob-blink {
		50% {
			opacity: 0;
		}
	}
	.ob-dots {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.ob-dots span {
		width: 4px;
		height: 4px;
		border-radius: 2px;
		background: #d8d3ca;
		transition: width 200ms ease;
	}
	.ob-dots span.active {
		width: 16px;
		background: #c65f3f;
	}
	@media (prefers-reduced-motion: reduce) {
		.ob-caret {
			animation: none;
		}
		.ob-dots span {
			transition: none;
		}
	}
</style>
