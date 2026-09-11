<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { PRODUCT_NAME, pageTitle } from '$lib/constants/brand';
	import { Button } from '@tironian/ui/button';
	import { FileDropZone } from '@tironian/ui/file-drop-zone';
	import { Link } from '@tironian/ui/link';
	import * as SectionHeader from '@tironian/ui/section-header';
	import * as ToggleGroup from '@tironian/ui/toggle-group';
	import type { UnlistenFn } from '@tauri-apps/api/event';
	import { onDestroy, onMount } from 'svelte';
	import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
	import { tryAsync } from 'wellcrafted/result';
	import DictationCapabilityNotice from '$lib/components/DictationCapabilityNotice.svelte';
	import { TranscriptionSelector } from '$lib/components/settings';
	import ProviderConfigFields from '$lib/components/settings/ProviderConfigFields.svelte';
	import ManualDeviceSelector from '$lib/components/settings/selectors/ManualDeviceSelector.svelte';
	import VadDeviceSelector from '$lib/components/settings/selectors/VadDeviceSelector.svelte';
	import {
		CAPTURE_SURFACE_META,
		CAPTURE_SURFACE_OPTIONS,
		type CaptureSurface,
	} from '$lib/constants/audio';
	import {
		IMPORT_ACCEPT,
		IMPORTABLE_AUDIO_EXTENSIONS,
		IMPORTABLE_VIDEO_EXTENSIONS,
		MAX_IMPORT_FILES,
		MAX_IMPORT_FILE_SIZE,
	} from '$lib/constants/import-formats';
	import { whisperingPath } from '$lib/constants/urls';
	import { importFiles } from '$lib/operations/import';
	import { selectCaptureSurface } from '$lib/operations/recording';
	import { deleteRecordingsWithConfirmation } from '$lib/operations/delete-recordings';
	import { report } from '$lib/report';
	import {
		getSelectedTranscriptionProvider,
		getTranscriptionReadiness,
	} from '$lib/settings/transcription-validation';
	import { captureSurface } from '$lib/state/capture-surface.svelte';
	import { localRoute } from '$lib/state/local-route.svelte';
	import { getRecordingShortcutLabel } from '$lib/utils/recording-shortcut';
	import { viewTransition } from '$lib/utils/viewTransitions';
	import { getWhisperingApp } from '$lib/whispering/context';
	import tironianMark from '$lib/assets/tironian-mark.png';
	import { tauri } from '#platform/tauri';
	import CaptureBehaviorPopover from './_components/CaptureBehaviorPopover.svelte';
	import CapturePipeline from './_components/CapturePipeline.svelte';
	import ManualRecordingAction from './_components/ManualRecordingAction.svelte';
	import PolishToggle from './_components/PolishToggle.svelte';
	import RecordingResult from './_components/RecordingResult.svelte';
	import VadRecordingAction from './_components/VadRecordingAction.svelte';

	const app = getWhisperingApp();

	const latestRecording = $derived(app.recordings.sorted[0]);
	const transcriptionReadiness = $derived(getTranscriptionReadiness(app));
	const hasActiveShortcut = $derived.by(() => {
		const surface = captureSurface.current(app);
		if (surface === 'import') return false;
		return !!getRecordingShortcutLabel(app, surface);
	});
	// This screen is onboarding, not configuration: when transcription is not
	// ready, ask for only the one required credential inline. A cloud provider
	// needs a single API key, so we render just that field (via `secretsOnly`)
	// and delegate the full provider/model/endpoint choice to Privacy &
	// Processing. A self-hosted setup (a server URL and model id) is too heavy
	// for the record screen and routes there instead.
	const inlineKeyProvider = $derived.by(() => {
		const provider = getSelectedTranscriptionProvider(app);
		return provider?.access === 'key' ? provider : null;
	});
	// The local route is the one blocker Tironian cannot clear anywhere in its
	// own settings: there is no key, endpoint, or model for this app to set, and
	// the active model belongs to the host (ADR-0180). So the action goes to the
	// surface that owns the fix rather than to a Tironian page that would only
	// repeat the same sentence and a second button.
	const needsHomeTranscriptionSetup = $derived(
		Boolean(tauri) &&
			getSelectedTranscriptionProvider(app)?.access === 'onDevice',
	);
	const PageError = defineErrors({
		DragDropListenerFailed: ({ cause }: { cause: unknown }) => ({
			message: `Failed to set up drag drop listener: ${extractErrorMessage(cause)}`,
			cause,
		}),
		FileRejected: ({
			fileName,
			reason,
		}: {
			fileName: string;
			reason: string;
		}) => ({
			message: `${fileName}: ${reason}`,
			fileName,
			reason,
		}),
	});

	let unlistenDragDrop: UnlistenFn | undefined;

	onMount(async () => {
		const desktop = tauri;
		if (!desktop) return;
		const { error } = await tryAsync({
			try: async () => {
				const isAudio = async (path: string) =>
					IMPORTABLE_AUDIO_EXTENSIONS.includes(
						(await desktop.fs.extension(
							path,
						)) as (typeof IMPORTABLE_AUDIO_EXTENSIONS)[number],
					);
				const isVideo = async (path: string) =>
					IMPORTABLE_VIDEO_EXTENSIONS.includes(
						(await desktop.fs.extension(
							path,
						)) as (typeof IMPORTABLE_VIDEO_EXTENSIONS)[number],
					);

				unlistenDragDrop = await desktop.fs.onDragDrop(
					async (paths) => {
						const pathResults = await Promise.all(
							paths.map(async (path) => ({
								path,
								isValid: (await isAudio(path)) || (await isVideo(path)),
							})),
						);
						const validPaths = pathResults
							.filter(({ isValid }) => isValid)
							.map(({ path }) => path);

						if (validPaths.length === 0) {
							report.info({
								title: m.app_no_valid_files(),
								description: m.app_please_drop_audio_or_video_files(),
							});
							return;
						}

						const { data: files, error } =
							await desktop.fs.pathsToFiles(validPaths);

						if (error) {
							report.error({ cause: error, title: m.app_failed_to_read_files() });
							return;
						}

						if (files.length > 0) {
							await importFiles(app, { files });
						}
					},
				);
			},
			catch: (error) =>
				PageError.DragDropListenerFailed({
					cause: error,
				}),
		});
		if (error) report.error({ cause: error });
	});

	onDestroy(() => {
		unlistenDragDrop?.();
	});
</script>

<svelte:head> <title>{pageTitle()}</title> </svelte:head>

<div
	class="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-start gap-5 px-4 pt-8 pb-24 sm:justify-center sm:py-12"
>
	<SectionHeader.Root class="flex flex-col items-center gap-2 text-center">
		<div class="flex items-center gap-2.5">
			<img src={tironianMark} alt="" class="size-8" />
			<SectionHeader.Title level={1} class="text-3xl">{PRODUCT_NAME}</SectionHeader.Title>
		</div>
		<SectionHeader.Description class="text-base">
			{m.app_press_shortcut_speak_get_text_free_and_open()}
		</SectionHeader.Description>
	</SectionHeader.Root>

	<DictationCapabilityNotice />

	{#if !transcriptionReadiness.isReady}
		<div class="w-full space-y-3">
			<div class="space-y-1">
				<h2 class="text-base font-semibold">{m.transcription_selector_set_up_transcription()}</h2>
				<p class="text-sm text-muted-foreground">
					{transcriptionReadiness.primaryIssue ??
						'Choose how Tironian turns your speech into text.'}
				</p>
			</div>
			{#if inlineKeyProvider}
				<ProviderConfigFields provider={inlineKeyProvider.id} secretsOnly />
				<p class="text-muted-foreground text-sm">
					<Link href={whisperingPath('/settings/processing')}>
						{m.app_change_provider_model_or_endpoint_in_privacy_amp()}
					</Link>
				</p>
			{:else if needsHomeTranscriptionSetup}
				<Button
					variant="outline"
					class="w-full"
					onclick={() => localRoute.openHomeTranscription()}
				>
					{m.app_set_up_in_epicenter_home({ productName: PRODUCT_NAME })}
				</Button>
				<p class="text-muted-foreground text-sm">
					{m.app_or()} <Link href={whisperingPath('/settings/processing')}>
						{m.app_transcribe_with_a_cloud_provider()}
					</Link> instead.
				</p>
			{:else}
				<Button
					href={whisperingPath('/settings/processing')}
					variant="outline"
					class="w-full"
				>
					{m.app_set_up_in_privacy_amp_processing()}
				</Button>
			{/if}
		</div>
	{:else}
		<ToggleGroup.Root
			type="single"
			bind:value={() => captureSurface.current(app),
				(surface) => {
					if (!surface) return;
					void selectCaptureSurface(app, surface as CaptureSurface);
				}}
			class="w-full"
		>
			{#each CAPTURE_SURFACE_OPTIONS as option}
				{@const SurfaceIcon = CAPTURE_SURFACE_META[option.value].Icon}
				<ToggleGroup.Item
					value={option.value}
					aria-label="Switch to {option.label.toLowerCase()}"
				>
					<SurfaceIcon class="size-4" />
					<span class="hidden truncate sm:inline">{option.label}</span>
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>

		{#if captureSurface.current(app) === 'manual'}
			<div class="flex w-full flex-col items-center gap-3">
				<ManualRecordingAction>
					{#snippet footer()}
						<CapturePipeline>
							<ManualDeviceSelector
								iconViewTransitionName={viewTransition.pipeline.device}
							/>
							<TranscriptionSelector
								variant="pipeline"
								iconViewTransitionName={viewTransition.pipeline.transcription}
							/>
							<PolishToggle />
							<CaptureBehaviorPopover />
						</CapturePipeline>
					{/snippet}
				</ManualRecordingAction>
			</div>
		{:else if captureSurface.current(app) === 'vad'}
			<div class="flex w-full flex-col items-center gap-3">
				<VadRecordingAction>
					{#snippet footer()}
						<CapturePipeline>
							<VadDeviceSelector
								iconViewTransitionName={viewTransition.pipeline.device}
							/>
							<TranscriptionSelector
								variant="pipeline"
								iconViewTransitionName={viewTransition.pipeline.transcription}
							/>
							<PolishToggle />
							<CaptureBehaviorPopover />
						</CapturePipeline>
					{/snippet}
				</VadRecordingAction>
			</div>
		{:else if captureSurface.current(app) === 'import'}
			<div class="flex w-full flex-col items-center gap-4">
				<FileDropZone
					accept={IMPORT_ACCEPT}
					maxFiles={MAX_IMPORT_FILES}
					maxFileSize={MAX_IMPORT_FILE_SIZE}
					onUpload={async (files) => {
						if (files.length > 0) {
							await importFiles(app, { files });
						}
					}}
					onFileRejected={({ file, reason }) => {
						report.error({
							cause: PageError.FileRejected({
								fileName: file.name,
								reason,
							}).error,
							title: 'File rejected',
						});
					}}
					class="h-32 sm:h-36 w-full"
				/>
				<CapturePipeline class="rounded-xl bg-card px-3 py-2 shadow-sm">
					<TranscriptionSelector
						variant="pipeline"
						iconViewTransitionName={viewTransition.pipeline.transcription}
					/>
					<PolishToggle />
				</CapturePipeline>
			</div>
		{/if}

		{#if latestRecording}
			<RecordingResult
				recordingId={latestRecording.id}
				audioBlobId={latestRecording.audioBlobId}
				transcript={latestRecording.polishedTranscript ?? latestRecording.transcript}
				rows={1}
				onDelete={() => {
					deleteRecordingsWithConfirmation(app, latestRecording);
				}}
			/>
		{/if}

		{#if captureSurface.current(app) !== 'import'}
			<p class="text-muted-foreground text-center text-sm">
				{#if hasActiveShortcut}
					Your shortcut works
					{tauri ? 'from any app.' : 'while this window is focused.'}
					<Link href={whisperingPath('/settings/shortcuts')}>{m.app_configure_shortcuts()}</Link>
				{:else}
					<Link href={whisperingPath('/settings/shortcuts')}>{m.app_set_a_shortcut()}</Link>
					{tauri ? 'to dictate from any app.' : 'to start recording.'}
				{/if}
			</p>
		{/if}

		{#if !tauri}
			<p class="text-muted-foreground text-center text-sm font-light">
				{m.app_tired_of_switching_tabs()}
				<Link
					tooltip={m.app_get_tironian_for_desktop({ productName: PRODUCT_NAME })}
					href="https://epicenter.so/whispering"
					target="_blank"
					rel="noopener noreferrer"
				>
					{m.app_get_the_native_desktop_app()}
				</Link>
			</p>
		{/if}
	{/if}
</div>
