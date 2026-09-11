import type { BlobId } from '@tironian/blobs';
import type { DeviceAcquisitionOutcome } from '@tironian/recorder';
import { createLogger } from 'wellcrafted/logger';
import { manualRecorderConfig } from '#platform/manual-recorder-config';
import { reportRecordingMicLevel } from '#platform/recording-mic-level';
import { goto } from '$app/navigation';
import type { CaptureSurface } from '$lib/constants/audio';
import { whisperingPath } from '$lib/constants/urls';
import { logAnalyticsEvent } from '$lib/operations/analytics';
import {
	captureForegroundSnapshot,
	type ForegroundSnapshot,
} from '$lib/operations/foreground-context';
import { probeFocusedField } from '$lib/operations/foreground-probe';
import { recordingMedia } from '$lib/operations/media';
import { processRecordingPipeline } from '$lib/operations/pipeline';
import { decideSecureFieldGuard } from '$lib/operations/secure-field-guard';
import { playSoundIfEnabled } from '$lib/operations/sound';
import { prewarmOnDeviceModel } from '$lib/operations/transcribe';
import { report } from '$lib/report';
import {
	RecorderError,
	type RecordingEndedReason,
} from '$lib/services/recorder/contract';
import { getTranscriptionPreflightBlocker } from '$lib/settings/transcription-validation';
import { captureSurface } from '$lib/state/capture-surface.svelte';
import { deviceConfig } from '$lib/state/device-config.svelte';
import { dictationLifecycle } from '$lib/state/dictation-lifecycle.svelte';
import { manualRecorder } from '$lib/state/manual-recorder.svelte';
import { vadRecorder } from '$lib/state/vad-recorder.svelte';
import type { WhisperingApp } from '$lib/whispering/app';
import { m } from '../paraglide/messages';

const log = createLogger('whispering/recording');

/**
 * Whether a capture may start, saying what is missing when it may not.
 *
 * The record screen swaps the recorder for a setup panel when transcription is
 * not ready, which reads as a gate but is only a rendering choice. The global
 * shortcut, push-to-talk, the tray, and the toggle command all reach the start
 * functions directly, so a capture ran anyway and failed at the provider: the
 * user learned after speaking, in a 401's words rather than in the one sentence
 * that names the fix.
 *
 * This is what every entry point shares, so the check lives here. It runs
 * before any audio exists, which is why refusing is the kind answer: it costs a
 * keypress, where starting costs a whole dictation that cannot become text. It
 * refuses only on what the app knows for certain, never on the on-device route,
 * whose failures the host owns and describes at the point of use (ADR-0180).
 */
function canStartCapture(app: WhisperingApp): boolean {
	const blocker = getTranscriptionPreflightBlocker(app);
	if (blocker === null) return true;

	report.info({
		title: m.recording_recording_not_started(),
		description: blocker,
		action: {
			label: 'Set up transcription',
			onClick: () => goto(whisperingPath('/settings/processing')),
		},
	});
	return false;
}

/**
 * Surface the outcome of acquiring a recording device. A clean success is
 * silent (the pill is the in-flight feedback). A fallback to a different
 * microphone is a standing config notice the pill cannot carry, so it is
 * reported here, and the chosen device is persisted so the next session keeps
 * it.
 */
function reportDeviceAcquisitionOutcome(
	outcome: DeviceAcquisitionOutcome,
	persist: (deviceId: string) => void,
): void {
	if (outcome.outcome === 'success') return;

	persist(outcome.deviceId);
	switch (outcome.reason) {
		// The microphone is chosen in the pipeline row on the record screen, not
		// in settings, so the recovery goes there rather than to a page that no
		// longer carries a device selector.
		case 'no-device-selected':
			report.info({
				title: m.recording_switched_to_available_microphone(),
				description: m.recording_no_microphone_was_selected_so_we(),
				action: {
					label: 'Choose microphone',
					onClick: () => goto(whisperingPath('/')),
				},
			});
			return;
		case 'preferred-device-unavailable':
			report.info({
				title: m.recording_switched_to_different_microphone(),
				description: m.recording_your_previously_selected_microphone_wasn_t(),
				action: {
					label: 'Choose microphone',
					onClick: () => goto(whisperingPath('/')),
				},
			});
			return;
	}
}

/**
 * What to say when a capture ends on its own. Each reason has a different
 * recovery, which is the whole reason the host distinguishes them.
 *
 * Each one says what happened to the *capture* and stops there. Saying the audio
 * was kept would be promising an outcome nobody knows yet: claiming it runs
 * through the ordinary stop, and a stop can still fail, most plausibly for
 * `storageFailed`, where the disk that could not take the samples may not take
 * the header patch either. The stop's own receipt (a transcript landing, or the
 * failure the pipeline reports) is what tells the person how it went.
 */
const ENDED_NOTICE: Record<RecordingEndedReason, string> = {
	deviceDisconnected: 'Your microphone disconnected, so the recording stopped.',
	permissionRevoked:
		'Microphone access was turned off, so the recording stopped.',
	streamFailed: 'Your microphone stopped working, so the recording stopped.',
	storageFailed:
		"Epicenter couldn't keep writing the recording to disk, so it stopped.",
};

/**
 * React to a capture ending without anyone asking: tell the person why, then
 * claim what it recorded.
 *
 * Capture death is the only ending nobody asked for, so it is the only one that
 * needs telling. What it does *not* need is a recovery path of its own: the
 * recording is still held, so it goes down the ordinary stop-and-transcribe
 * route and lands in the history like any other. The alternative, throwing the
 * audio away and reporting a loss, was the previous behavior and is the loss
 * this whole design exists to stop.
 *
 * The stop can still fail, and then `stopManualRecording` reports the loss on
 * its own terms. That is why the notice above describes the capture ending and
 * says nothing about what became of the audio: two messages, one per fact, each
 * sent when it is actually known.
 *
 * Session-scoped rather than registered at import, because claiming the audio
 * means running the pipeline, which needs the app. One handler replaces the
 * last, so a new UI session re-registering is not a leak.
 */
export function watchManualRecordingEnded(app: WhisperingApp): void {
	manualRecorder.onEnded((reason) => {
		const { error } = RecorderError.RecorderFailed({
			cause: ENDED_NOTICE[reason],
		});
		report.error({ title: m.push_to_talk_recording_stopped(), cause: error });
		void stopManualRecording(app);
	});
}

/**
 * The foreground snapshots for captures in flight, taken at recording start
 * (manual) or speech start (VAD) and consumed when each capture's pipeline
 * runs. Promises so the probe overlaps the recording instead of delaying its
 * start; a probe failure resolves to null and routing simply does not apply.
 * Skipped entirely while no rules exist, so the zero-rule case costs nothing.
 *
 * A FIFO, not a single slot: VAD speech events arrive in order (start 1,
 * end 1, start 2, ...), but utterance 1's async end handler can still be
 * storing audio when utterance 2's start fires. A slot would let utterance 1
 * consume utterance 2's snapshot; pairing begins to takes in order cannot.
 * Every path that begins must also take or discard, so a capture that never
 * reaches a pipeline (a failed start, a cancel, a VAD misfire) cannot leave
 * an entry behind for the next capture to inherit; consumers shift
 * synchronously, before their first await, to keep the pairing.
 */
const pendingForeground: Promise<ForegroundSnapshot | null>[] = [];

function beginForegroundSnapshot(app: WhisperingApp): void {
	pendingForeground.push(
		app.appRules.count > 0
			? captureForegroundSnapshot().catch(() => null)
			: Promise.resolve(null),
	);
}

async function takeForegroundSnapshot(): Promise<ForegroundSnapshot | null> {
	return pendingForeground.shift() ?? null;
}

/** Drop a capture's entry when it will never reach a pipeline (a failed
 * start, a cancel, a VAD misfire), so the next capture cannot inherit it. */
function discardForegroundSnapshot(): void {
	pendingForeground.shift();
}

/** True while a VAD session is armed, whether or not speech is being heard. */
export function isVadRecordingActive() {
	return (
		vadRecorder.state === 'LISTENING' || vadRecorder.state === 'SPEECH_DETECTED'
	);
}

/**
 * Start a manual recording and return the id of the recording it started, or
 * `null` when it did not start one (it failed, or a recording was already live so
 * this call was a no-op). Push-to-talk remembers that id to later stop only the
 * exact recording it owns; the button and toggle paths ignore the return.
 */
export async function startManualRecording(
	app: WhisperingApp,
): Promise<BlobId | null> {
	if (!canStartCapture(app)) return null;

	// The opt-in secure-field capture gate: refuse to start while a detected
	// password field has focus, before any audio exists. This is the only gate
	// that keeps a dictated secret from reaching a cloud transcription or
	// Polish provider; the always-available delivery withhold only stops the
	// paste. Fail-open like the rest of the guard, so an `unknown` verdict
	// (no grant, elevated target) never refuses a recording. Manual capture
	// only: a VAD session is armed once and speaks much later, so a
	// field-focus check at arming time would attest to nothing.
	if (app.settings.get('secureFieldCaptureGateEnabled')) {
		const focusedField = await probeFocusedField();
		const decision = decideSecureFieldGuard({ focusedField, enabled: true });
		if (decision === 'withhold') {
			report.info({
				title: m.recording_recording_not_started(),
				description: m.recording_a_password_field_has_focus_move_focus(),
			});
			return null;
		}
	}

	app.settings.set('recordingTrigger', 'manual');
	// The app in front right now is what this dictation is aimed at; the probe
	// runs alongside the recorder bring-up and is consumed at stop.
	beginForegroundSnapshot(app);
	// A new dictation is starting: clear any lingering failed/delivered state so
	// the pill follows this attempt, not the last one.
	dictationLifecycle.reset();
	// A capture just started, so leave the import overlay if it was open: the
	// surface should follow the live recording, not stay parked on import.
	captureSurface.dismissImport();

	// Kick off the local model load now, concurrently with bringing up the
	// recorder, so the ~1 s cold load overlaps the speech you're about to
	// record rather than being paid after you stop. No-op for cloud/web.
	prewarmOnDeviceModel(app);

	// Manual owns playback for the whole recording; drop any leftover VAD
	// per-utterance resume so it cannot fire mid-recording.
	cancelPendingVadResume();
	recordingMedia.pause(app);

	const { data: recording, error } = await manualRecorder.startRecording();

	if (error) {
		void recordingMedia.resume();
		discardForegroundSnapshot();
		// The recording never started, so there is no blob to recover: the
		// loudest tier. The pill glances it and the OS notification always fires, so
		// there is no toast.
		dictationLifecycle.markFailed({ tier: 'silent-loss', error });
		return null;
	}

	// Feed the pill's meter the live mic level. The browser recorder taps its
	// MediaStream; the native one forwards the level the host measures.
	recording.onLevel(reportRecordingMicLevel);

	// The pill shows the live recording; only a device fallback needs a notice.
	reportDeviceAcquisitionOutcome(recording.device, (deviceId) => {
		manualRecorderConfig.deviceId = deviceId;
	});

	log.info('Recording started');
	void playSoundIfEnabled(app, 'manual-start');
	return manualRecorder.currentAudioBlobId;
}

export async function stopManualRecording(app: WhisperingApp) {
	const { data: source, error } = await manualRecorder.stopRecording();

	if (error) {
		void recordingMedia.resume();
		discardForegroundSnapshot();
		// Finalizing failed, so the captured audio never reached a row: treat it
		// as a silent loss rather than a retryable transcription.
		dictationLifecycle.markFailed({ tier: 'silent-loss', error });
		return;
	}

	const { audioBlobId, durationMs, byteLength } = source;

	// The pill carries "stopped -> transcribing"; the transcript landing is the
	// receipt. No per-step toast.
	log.info('Recording stopped');
	void playSoundIfEnabled(app, 'manual-stop');
	void recordingMedia.resume();

	void logAnalyticsEvent(app, {
		type: 'manual_recording_completed',
		blob_size: byteLength,
		duration: durationMs,
	});

	await processRecordingPipeline(app, {
		audioBlobId,
		durationMs,
		foregroundApp: await takeForegroundSnapshot(),
	});
}

/**
 * Stop the manual recording only if `recordingId` names the one that is live. A
 * no-op otherwise, so a push-to-talk release that is stray, duplicated, or lands
 * after its recording was supplanted by a toggle/button recording never stops the
 * wrong one. This is the idempotent stop push-to-talk routes every stop through.
 */
export async function stopManualRecordingById(
	app: WhisperingApp,
	recordingId: BlobId,
) {
	if (
		manualRecorder.state !== 'RECORDING' ||
		manualRecorder.currentAudioBlobId !== recordingId
	) {
		return;
	}
	await stopManualRecording(app);
}

export function toggleManualRecording(app: WhisperingApp) {
	if (manualRecorder.state === 'RECORDING') {
		return stopManualRecording(app);
	}
	return startManualRecording(app);
}

export async function cancelRecording(app: WhisperingApp) {
	// Note: distinct from the low-level Tauri `commands.cancelRecording()` (CPAL
	// stream teardown). This is the user-facing command: it decides what "cancel"
	// means across the manual and VAD recorders.
	//
	// Cancel aborts whichever capture is live, without touching
	// `recordingTrigger`: the chosen trigger (manual vs VAD) is a deliberate
	// preference, not
	// something a cancel keystroke should flip, so cancelling in VAD mode leaves
	// you in VAD mode, idle and ready to listen again. This is also the global
	// cancel chord (Cmd + . on macOS), which the global-shortcut plugin fires only
	// on that exact chord, so when nothing is live it stays silent rather than
	// toasting on an unrelated press.

	// A manual recording is the live capture: discard it.
	const { data, error } = await manualRecorder.cancelRecording();
	if (error) {
		report.error({
			title: m.recording_failed_to_cancel_recording(),
			cause: error,
		});
		return;
	}
	if (data.status === 'cancelled') {
		void recordingMedia.resume();
		discardForegroundSnapshot();
		// The pill vanishing plus the cancel sound is the confirmation; no toast.
		void playSoundIfEnabled(app, 'manual-cancel');
		log.info('Recording cancelled');
		return;
	}

	// No manual recording, but a VAD session may be live. VAD has no
	// discard-vs-finalize split: tearing the session down is the only way to
	// abort it, which is exactly what stopVadRecording already does (same
	// stopActiveListening call, same end state, mode left on `vad`). So cancel a
	// live VAD session by stopping it, rather than cloning the teardown with a
	// second toast and a manual-recording sound. Nothing live: silent no-op.
	if (isVadRecordingActive()) await stopVadRecording(app);
}

// VAD pauses playback per utterance (the speaking window), not for the whole
// armed session: music keeps playing while you are armed-and-silent and stops
// only while you actually speak. A return to listening (speech end or a misfire)
// schedules a debounced resume so back-to-back utterances do not flutter the
// music; the next speech start cancels that pending resume. Ending the session
// resumes immediately. See ADR-0027.
let vadResumeTimer: ReturnType<typeof setTimeout> | undefined;
const VAD_RESUME_DELAY_MS = 1500;

function pausePlaybackForSpeech(app: WhisperingApp) {
	clearTimeout(vadResumeTimer);
	vadResumeTimer = undefined;
	recordingMedia.pause(app);
}

function scheduleResumeAfterSpeech() {
	clearTimeout(vadResumeTimer);
	vadResumeTimer = setTimeout(() => {
		vadResumeTimer = undefined;
		void recordingMedia.resume();
	}, VAD_RESUME_DELAY_MS);
}

/** Resume now and drop any pending debounce: the VAD session is ending. */
function resumePlaybackForVadEnd() {
	clearTimeout(vadResumeTimer);
	vadResumeTimer = undefined;
	void recordingMedia.resume();
}

/**
 * Drop a pending VAD resume without resuming. Used when a manual recording
 * starts: manual owns playback for its whole window, so a debounce left over
 * from a prior VAD utterance must not fire and resume music mid-recording.
 */
function cancelPendingVadResume() {
	clearTimeout(vadResumeTimer);
	vadResumeTimer = undefined;
}

export async function startVadRecording(app: WhisperingApp) {
	// A session is armed once and speaks many times, so an unusable provider
	// here would fail every utterance in it, not one.
	if (!canStartCapture(app)) return;

	app.settings.set('recordingTrigger', 'vad');
	// A new dictation session is starting: clear any lingering terminal state.
	dictationLifecycle.reset();
	// A capture just started, so leave the import overlay if it was open (see
	// startManualRecording).
	captureSurface.dismissImport();

	// Warm the local model when listening is armed (not when speech is
	// detected): arming VAD is the "about to dictate" signal, and starting the
	// load now means the model is ready before the first word, even for a short
	// utterance. No-op for cloud/web.
	prewarmOnDeviceModel(app);

	log.info('Starting voice activated capture');

	const { data: outcome, error } = await vadRecorder.startActiveListening({
		onLevel: reportRecordingMicLevel,
		onSpeechStart: () => {
			// Speaking window opened: pause whatever is playing. The pill's meter
			// tint shows speech was detected, so there is no toast. Each utterance
			// is its own pipeline run, so each gets its own foreground snapshot.
			beginForegroundSnapshot(app);
			pausePlaybackForSpeech(app);
		},
		onSpeechEnd: async (blob) => {
			// Claim this utterance's snapshot before the first await: speech
			// events are ordered, so a synchronous shift here pairs each end
			// with its own start even while audio storage is still in flight.
			const foregroundApp = takeForegroundSnapshot();
			// Speaking window closed: resume after a short debounce so a quick
			// next utterance does not flutter the music.
			scheduleResumeAfterSpeech();
			log.info('Voice activated speech captured');
			void playSoundIfEnabled(app, 'vad-capture');

			void logAnalyticsEvent(app, {
				type: 'vad_recording_completed',
				blob_size: blob.size,
			});

			const finalized = await app.recordings.storeAudio(blob);
			if (finalized.error !== null) {
				dictationLifecycle.markFailed({
					tier: 'silent-loss',
					error: finalized.error,
				});
				return;
			}
			await processRecordingPipeline(app, {
				audioBlobId: finalized.data.audioBlobId,
				durationMs: null,
				foregroundApp: await foregroundApp,
			});
		},
		onVADMisfire: () => {
			// False start: schedule the same debounced resume as a real speech
			// end, so an immediate retry does not flutter the music. The
			// utterance never reaches a pipeline, so its snapshot goes too.
			discardForegroundSnapshot();
			scheduleResumeAfterSpeech();
		},
	});

	if (error) {
		resumePlaybackForVadEnd();
		// Listening never armed, so nothing was captured: a silent loss.
		dictationLifecycle.markFailed({ tier: 'silent-loss', error });
		return;
	}

	// The pill shows the armed session; only a device fallback needs a notice.
	reportDeviceAcquisitionOutcome(outcome, (deviceId) =>
		deviceConfig.set('recording.navigator.deviceId', deviceId),
	);

	void playSoundIfEnabled(app, 'vad-start');
}

export async function stopVadRecording(app: WhisperingApp) {
	if (!isVadRecordingActive()) return;

	log.info('Stopping voice activated capture');
	const { data, error } = await vadRecorder.stopActiveListening();
	// Disarming ends the session: restore playback now, do not wait on the
	// per-utterance debounce.
	resumePlaybackForVadEnd();
	if (error) {
		// Stop is an operation with no capture/outcome phase, so the pill cannot
		// carry it: a failed disarm keeps a toast (ADR-0039's operation-condition
		// carve-out). The session may still be live, so the user must know it did
		// not stop.
		report.error({
			title: m.recording_couldn_t_stop_voice_activated_capture(),
			description: m.recording_the_session_may_still_be_running_try(),
			cause: error,
		});
		return;
	}
	if (data.status === 'idle') return;
	void playSoundIfEnabled(app, 'vad-stop');
}

export function toggleVadRecording(app: WhisperingApp) {
	if (isVadRecordingActive()) {
		return stopVadRecording(app);
	}
	return startVadRecording(app);
}

/**
 * Select a capture surface from the homepage tabs or the header dropdown.
 * `import` opens the transient import overlay without touching
 * `recordingTrigger`; `manual`/`vad` close the overlay and switch the durable
 * trigger. Either way, a live capture on a different surface is stopped first so
 * two captures never overlap (`import` keeps neither recorder, so both stop).
 */
export async function selectCaptureSurface(
	app: WhisperingApp,
	surface: CaptureSurface,
) {
	// Flip the surface first so the tab/dropdown responds instantly; the live
	// capture stopped below finalizes and transcribes in the background rather
	// than blocking the switch.
	if (surface === 'import') {
		captureSurface.showImport();
	} else {
		captureSurface.dismissImport();
		if (app.settings.get('recordingTrigger') !== surface) {
			app.settings.set('recordingTrigger', surface);
		}
	}

	// Stop a live capture on a different surface so two captures never overlap
	// (`import` keeps neither recorder, so both stop). Stopping finalizes it: a
	// manual recording is saved and transcribed, and a voice-activated utterance
	// in progress is flushed through the pipeline (the VAD runs with
	// `submitUserSpeechOnPause`), so nothing you already said is lost.
	if (surface !== 'manual' && manualRecorder.state === 'RECORDING') {
		await stopManualRecording(app);
	}
	if (surface !== 'vad' && isVadRecordingActive()) {
		await stopVadRecording(app);
	}
}
