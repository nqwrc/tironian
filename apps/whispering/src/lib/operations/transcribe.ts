import type { BlobId } from '@epicenter/blobs';
import {
	type ResolvedConnection,
	resolveConnection,
	transcribe,
} from '@epicenter/client';
import { containsSpeech } from '@epicenter/recorder';
import { type AnyTaggedError, defineErrors } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import { Err, Ok, type Result } from 'wellcrafted/result';
import { WHISPERING_BASE_PATHNAME } from '#platform/base-path';
import { customFetch } from '#platform/http';
import { tauri } from '#platform/tauri';
import {
	isSupportedLanguage,
	type SupportedLanguage,
} from '$lib/constants/languages';
import { logAnalyticsEvent } from '$lib/operations/analytics';
import {
	buildTranscriptionPrompt,
	recognizerPromptCharBudget,
} from '$lib/operations/build-transcription-prompt';
import {
	type TranscriptionDeadline,
	transcriptionTimedOut,
	transcriptionTimeoutMs,
	withDeadline,
} from '$lib/operations/transcription-deadline';
import {
	recordTranscriptionOutcome,
	type TranscriptionSuccess,
} from '$lib/operations/transcription-history';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { DeepgramTranscriptionServiceLive } from '$lib/services/transcription/cloud/deepgram';
import { ElevenLabsTranscriptionServiceLive } from '$lib/services/transcription/cloud/elevenlabs';
import { MistralTranscriptionServiceLive } from '$lib/services/transcription/cloud/mistral';
import {
	isOnDeviceProviderId,
	type OnDeviceProviderId,
	PROVIDERS,
	type TranscriptionServiceId,
	type UploadProviderId,
} from '$lib/services/transcription/providers';
import { getTranscriptionPreflightBlocker } from '$lib/settings/transcription-validation';
import { deviceConfig } from '$lib/state/device-config.svelte';
import { type SecretKey, secrets } from '$lib/state/secrets.svelte';
import type { WhisperingApp } from '$lib/whispering/app';
import type { RecordingId } from '$lib/workspace';
import { m } from '../paraglide/messages';

const log = createLogger('whispering/transcribe');

/**
 * The error any transcription path can surface. Deliberately `AnyTaggedError`
 * rather than the concrete provider-error union: every consumer (toast,
 * failed-row tooltip, practice view, analytics) presents these by `.message`,
 * and none discriminate on `.name`. The user-facing message is curated where
 * the context lives, in each service's `defineErrors` constructors, so this
 * boundary only needs to promise `{ name, message }`. Widening to the full
 * union would add error variants no consumer reads.
 */
export type TranscriptionError = AnyTaggedError;

export type { TranscriptionSuccess } from '$lib/operations/transcription-history';

const TranscriptionOperationError = defineErrors({
	LocalTranscriptionUnavailableOnWeb: () => ({
		message: m.transcribe_local_transcription_is_only_available_in(),
	}),
	/** Whispering already knows this cannot succeed: nothing is selected, or the
	 *  selected provider has no usable credential. Carries the same sentence the
	 *  record screen shows, so a missing key reads as a missing key instead of
	 *  arriving as a provider's 401 after the audio has already been sent. */
	TranscriptionNotSetUp: ({ issue }: { issue: string }) => ({
		message: issue,
	}),
});

/**
 * How an upload (non-on-device) provider is reached. A `wire` provider resolves its own
 * transport and a model and hands them to the shared `transcribe()`; a `bespoke`
 * provider keeps its own SDK client (a different wire). The `kind` discriminant
 * carries the routing, so there is no wire-vs-bespoke id subset to derive and no
 * `in`-guard: one exhaustive switch on `.kind`.
 *
 * The transport is a `resolve` thunk, not static connection data, so each wire entry
 * owns how it becomes a transport (ADR-0060): a `key`/`endpoint` entry resolves a
 * `{ baseUrl, apiKey }` over `customFetch`. The switch therefore never branches on
 * what kind of transport it got.
 *
 * A bespoke entry closes over its own key and model (from the literal `PROVIDERS.X`
 * pointers, the SSOT) rather than letting the caller read `PROVIDERS[id]`, because
 * switching on `.kind` does not narrow the id back to a KeyProvider. The wire
 * entries read the same pointers; the one fact `PROVIDERS` does not hold is the
 * canonical wire base URL (it used to be each SDK's default), so that literal lives
 * here.
 */
type UploadDispatch =
	| {
			kind: 'wire';
			resolve: () => ResolvedConnection;
			model: () => string;
	  }
	| {
			kind: 'bespoke';
			transcribe: (
				audio: Blob,
				options: { prompt: string; spokenLanguage: SupportedLanguage },
			) => Promise<Result<string, TranscriptionError>>;
	  };

/**
 * Read a provider API key through the credential facade (ADR-0074): the key when
 * set, undefined when missing. A provider key is a secret, so it routes through
 * `secrets`, never raw `deviceConfig`. Device-local plaintext.
 */
function secretApiKey(key: SecretKey): string | undefined {
	const read = secrets.get(key);
	return read.status === 'available' ? read.value : undefined;
}

/**
 * Every upload transcription provider, keyed by id. `satisfies Record<UploadProviderId,
 * UploadDispatch>` makes the table total over the non-on-device providers: a new cloud or
 * self-hosted provider is a compile error until it has an entry, and an on-device
 * provider cannot appear (it goes through the FFI path, branched in `transcribeAudio`).
 *
 * Wire entries (OpenAI, Groq, Speaches): the endpoint override beats the canonical
 * default; Speaches stores a bare host, so its `/v1` is appended; a keyless local
 * box sends no key. Bespoke entries (ElevenLabs, Deepgram, Mistral) keep their own
 * clients because they do not speak the wire (Deepgram's raw body + `Authorization:
 * Token`, ElevenLabs' `xi-api-key`, Mistral's own `@mistralai/mistralai` SDK);
 * ADR-0060 blesses it.
 */
const uploadDispatch = (app: WhisperingApp) =>
	({
		OpenAI: {
			kind: 'wire',
			resolve: () =>
				resolveConnection(
					{
						baseUrl:
							deviceConfig.get(PROVIDERS.OpenAI.endpointConfigKey) ||
							'https://api.openai.com/v1',
						apiKey: secretApiKey(PROVIDERS.OpenAI.apiKeyConfigKey),
					},
					customFetch,
				),
			model: () => app.settings.get(PROVIDERS.OpenAI.modelSettingKey),
		},
		Groq: {
			kind: 'wire',
			resolve: () =>
				resolveConnection(
					{
						baseUrl:
							deviceConfig.get(PROVIDERS.Groq.endpointConfigKey) ||
							'https://api.groq.com/openai/v1',
						apiKey: secretApiKey(PROVIDERS.Groq.apiKeyConfigKey),
					},
					customFetch,
				),
			model: () => app.settings.get(PROVIDERS.Groq.modelSettingKey),
		},
		speaches: {
			kind: 'wire',
			resolve: () =>
				resolveConnection(
					{
						baseUrl: `${deviceConfig.get(PROVIDERS.speaches.endpointConfigKey)}/v1`,
					},
					customFetch,
				),
			model: () => deviceConfig.get(PROVIDERS.speaches.modelIdConfigKey),
		},
		ElevenLabs: {
			kind: 'bespoke',
			transcribe: (audio, { prompt, spokenLanguage }) =>
				ElevenLabsTranscriptionServiceLive.transcribe(audio, {
					prompt,
					spokenLanguage,
					apiKey: secretApiKey(PROVIDERS.ElevenLabs.apiKeyConfigKey) ?? '',
					modelName: app.settings.get(PROVIDERS.ElevenLabs.modelSettingKey),
				}),
		},
		Deepgram: {
			kind: 'bespoke',
			transcribe: (audio, { prompt, spokenLanguage }) =>
				DeepgramTranscriptionServiceLive.transcribe(audio, {
					prompt,
					spokenLanguage,
					apiKey: secretApiKey(PROVIDERS.Deepgram.apiKeyConfigKey) ?? '',
					modelName: app.settings.get(PROVIDERS.Deepgram.modelSettingKey),
				}),
		},
		Mistral: {
			kind: 'bespoke',
			transcribe: (audio, { prompt, spokenLanguage }) =>
				MistralTranscriptionServiceLive.transcribe(audio, {
					prompt,
					spokenLanguage,
					apiKey: secretApiKey(PROVIDERS.Mistral.apiKeyConfigKey) ?? '',
					modelName: app.settings.get(PROVIDERS.Mistral.modelSettingKey),
				}),
		},
	}) satisfies Record<UploadProviderId, UploadDispatch>;

/**
 * Materialize the bytes for an upload transcription. On Tauri, Rust reads the
 * local blob and compresses it with libopus. On the web, the original local
 * blob is uploaded as-is.
 */
async function loadForUpload(
	app: WhisperingApp,
	audioBlobId: BlobId,
): Promise<Result<Blob, TranscriptionError>> {
	if (tauri) {
		const { data: oggBytes, error } =
			await tauri.transcription.encodeRecordingForUpload(audioBlobId);
		if (error === null) return Ok(new Blob([oggBytes], { type: 'audio/ogg' }));
		report.info({
			title: m.transcribe_audio_compression_skipped(),
			description: `${error}. Uploading uncompressed audio instead.`,
		});
		void logAnalyticsEvent(app, {
			type: 'compression_failed',
			provider: app.settings.get('transcriptionService'),
			error_message: error,
		});
	}

	return services.blobs.local.get(audioBlobId);
}

/**
 * Transcribe a saved recording by id. This is the single canonical entry
 * point for transcription:
 *
 * - The cpal stop path saves the WAV via Rust and returns the id.
 * - The navigator / VAD / file import paths commit the local blob and pass
 *   its id here.
 *
 * Local transcription always goes through `transcribe_recording(id)`.
 * Upload (non-on-device) transcription uploads compressed bytes derived from the
 * saved file when possible, falling back to the raw blob.
 *
 * `deadline` says which situation is waiting, and so how long this is willing to
 * wait before giving up on the route: tight for a live dictation, generous for
 * an import or a retry. Required rather than defaulted, because guessing wrong
 * in either direction has a real cost (a killed import, or a dictation session
 * held behind a route that is never coming back) and every caller knows which
 * one it is.
 */
export async function transcribeAudio(
	app: WhisperingApp,
	audioBlobId: BlobId,
	{ deadline }: { deadline: TranscriptionDeadline },
): Promise<Result<string, TranscriptionError>> {
	const selectedService = app.settings.get('transcriptionService');

	const startTime = Date.now();
	void logAnalyticsEvent(app, {
		type: 'transcription_requested',
		provider: selectedService,
	});

	// The capture paths refuse before recording, but they are not the only way
	// in: a file import and a retry from the recordings list both arrive here
	// with audio already in hand. Answering with the known blocker costs nothing
	// and beats uploading the clip to collect a 401 that names the provider
	// rather than the fix.
	const blocker = getTranscriptionPreflightBlocker(app);
	if (blocker !== null) {
		const notSetUp = TranscriptionOperationError.TranscriptionNotSetUp({
			issue: blocker,
		});
		void logAnalyticsEvent(app, {
			type: 'transcription_failed',
			provider: selectedService,
			error_name: notSetUp.error.name,
			error_message: notSetUp.error.message,
		});
		return notSetUp;
	}

	// One wait covers everything that can hang: the silence gate, the FFI call,
	// the upload. It is a ceiling for a route that is never coming back, not a
	// latency budget, and it cancels nothing (see `withDeadline`).
	//
	// Inside `transcribeAudio` rather than around it, so an expiry is an
	// ordinary transcription failure: the analytics branch below reports it by
	// name, and `transcribeAndPersist` marks the row failed. That leaves the
	// audio retryable from the recordings list, which is the only recovery there
	// is, because unlike a polish pass there is no raw text to fall back on.
	//
	// On the on-device route the abandoned call keeps Rust's model mutex, which
	// is held across load and inference (`model_cache.rs`), so every later local
	// run blocks on it and expires too until the app restarts. That wedge is
	// there with or without this deadline. What changes is that it is reported
	// rather than silent.
	const transcriptionResult = await withDeadline(
		transcriptionTimeoutMs(deadline),
		() => transcriptionTimedOut(deadline),
		async () => {
			// Silence never reaches a recognizer, whichever one is selected.
			//
			// Whisper cannot decline to answer: given a clip with no speech
			// in it, the decoder still emits its highest-prior caption, which
			// is why a tap of push-to-talk with nothing said pastes "Thank
			// you." at the cursor. The on-device route already refused to run
			// a model on empty audio and reported `empty-audio`; the upload
			// route had no equivalent and posted the clip anyway. That made
			// one policy two implementations, and only the route nobody was
			// using was protected.
			//
			// So the gate sits above the fork, in the one place that already
			// decides on-device-ness, and both arms inherit it. An empty
			// transcript is the same honest answer `empty-audio` gives, so
			// this adds no new outcome for callers to learn.
			// `containsSpeech` answers `true` whenever it cannot tell, so a
			// broken gate transcribes rather than discards.
			//
			// The cost is that the on-device arm now reads the blob here to
			// be asked the question and Rust reads it again to transcribe.
			// That is the price of one gate instead of two, and it is worth
			// naming rather than discovering.
			//
			// It sits inside the deadline rather than above it, which bounds
			// `containsSpeech` too: it fetches a VAD model over the network
			// on first use, so it is one more thing that can fail to come
			// back. An empty transcript still reports
			// `transcription_completed` from the tail below, the same event
			// this gate used to send on its own.
			if (await isSilent(app, audioBlobId)) return Ok('');

			// The one place on-device-ness is decided. The type guard narrows
			// `selectedService` to `OnDeviceProviderId` in one arm and
			// `UploadProviderId` in the other, so each helper receives an
			// already-narrowed id and neither re-checks.
			return isOnDeviceProviderId(selectedService)
				? transcribeOnDevice(app, audioBlobId, selectedService)
				: transcribeViaUpload(app, audioBlobId, selectedService);
		},
	);

	const duration = Date.now() - startTime;
	if (transcriptionResult.error) {
		void logAnalyticsEvent(app, {
			type: 'transcription_failed',
			provider: selectedService,
			error_name: transcriptionResult.error.name,
			error_message: transcriptionResult.error.message,
		});
	} else {
		void logAnalyticsEvent(app, {
			type: 'transcription_completed',
			provider: selectedService,
			duration,
		});
	}

	return transcriptionResult;
}

/**
 * Whether a saved recording has no speech in it.
 *
 * Reads the raw local blob rather than the upload-encoded bytes: the question is
 * about the audio, not about what a provider is willing to accept, and going
 * through the opus encode would make the answer depend on which route was
 * selected. A blob that cannot be read is not evidence of silence, so it
 * transcribes, matching `containsSpeech`'s own refusal to fail closed.
 */
async function isSilent(
	app: WhisperingApp,
	audioBlobId: BlobId,
): Promise<boolean> {
	const { data: audio, error } = await services.blobs.local.get(audioBlobId);
	if (error) return false;
	const speech = await containsSpeech({
		audio,
		assetBaseUrl: `${WHISPERING_BASE_PATHNAME}/vad/`,
	});
	if (!speech) {
		log.info('Skipped transcription: the recording contains no speech', {
			audioBlobId,
		});
	}
	return !speech;
}

/**
 * Transcribe a saved recording by id and attempt to persist the outcome to the
 * recordings table. Successful text remains successful when history cannot be
 * confirmed: callers receive that secondary Result and choose how to warn.
 * Every path that transcribes (the record pipeline, manual retry, bulk) goes
 * through here, so they share one history-write policy.
 */
export async function transcribeAndPersist(
	app: WhisperingApp,
	recordingId: RecordingId,
	audioBlobId: BlobId,
	{ deadline }: { deadline: TranscriptionDeadline },
): Promise<Result<TranscriptionSuccess, TranscriptionError>> {
	return recordTranscriptionOutcome(
		app,
		recordingId,
		await transcribeAudio(app, audioBlobId, { deadline }),
	);
}

/**
 * Warm the host's active local model the instant a capture begins, so the cold
 * load (~1 s) overlaps the user's speech instead of being paid after they
 * stop. Called fire-and-forget from the manual and VAD start paths.
 *
 * No-op unless we are on desktop with the local route selected: cloud and
 * self-hosted have no on-device model to load, and web has no Rust. The host
 * resolves the same active model here as it does at transcribe, because there is
 * only one (ADR-0180), so what is warmed is what will run. Failures are
 * swallowed on purpose: the worst case is transcription loads the model itself,
 * and a real problem (no active model, not downloaded) surfaces there with a
 * message the user can act on.
 */
export function prewarmOnDeviceModel(app: WhisperingApp): void {
	if (!tauri) return;

	const selectedService = app.settings.get('transcriptionService');
	if (!isOnDeviceProviderId(selectedService)) return;

	tauri.transcription.prewarmModel();
}

/**
 * Read the recognizer's advisory prompt from settings, Dictionary folded in.
 *
 * Every arm composes it the same way, so it is composed here, and each passes the
 * route it is about to call. The Whisper prompt ceiling is Whisper's alone, so a
 * Deepgram keyterm list and a `gpt-4o-transcribe` prompt go out whole while a
 * Whisper route is clipped; `recognizerPromptCharBudget` owns which is which.
 *
 * When the route does carry the bound, a long Dictionary loses its tail, and that
 * loss is what the log line exists for. It is deliberately not a toast: the
 * transcript still succeeds, this runs on every dictation, and a standing
 * `report.warning` per dictation would be louder than the problem. The present
 * tense surface is the Dictionary card on the dictation settings page, which
 * calls the same pair of functions and says which terms do not reach the
 * recognizer while the person is standing in front of the list. This line is the
 * after-the-fact record, alongside the applied-hints log below, so "my Dictionary
 * had no effect" has an answer here too.
 */
function recognizerPrompt(
	app: WhisperingApp,
	service: TranscriptionServiceId,
	/** The model about to run, where the caller has resolved one. */
	model: string | null,
): string {
	const { prompt, dropped } = buildTranscriptionPrompt(
		app.settings.get('transcriptionPrompt'),
		app.settings.get('dictionary'),
		recognizerPromptCharBudget(service, model),
	);
	if (dropped.length > 0) {
		// The count and the boundary term are the whole answer. The tail itself can
		// run to hundreds of the person's proper nouns, and this line is written on
		// every dictation, so logging the array would trade volume for nothing.
		log.info('Dictionary terms did not fit the recognizer prompt budget', {
			droppedCount: dropped.length,
			firstDropped: dropped[0],
		});
	}
	return prompt;
}

/**
 * Transcribe on the host's one active local model.
 *
 * Whispering names audio and advisory hints; it does not name a model
 * (ADR-0180). The host resolves the active model at the point of use and
 * reports which model actually ran, so a model that appears on disk after a
 * failed load works on the very next call, and no request can quietly change
 * what the shared cache holds. Every failure mode here is the host's to
 * describe: no active model, an active model that is not downloaded, a load or
 * inference failure. Each arrives as a tagged error carrying a message that
 * names the fix, so there is no frontend pre-check to drift from it.
 */
async function transcribeOnDevice(
	app: WhisperingApp,
	audioBlobId: BlobId,
	selectedService: OnDeviceProviderId,
): Promise<Result<string, TranscriptionError>> {
	if (!tauri) {
		return TranscriptionOperationError.LocalTranscriptionUnavailableOnWeb();
	}

	// Read-at-use: the hints are built right here, where they are consumed, so
	// there is no ambient config to go stale. `auto` language and an empty prompt
	// map to the wire's "unset" (an omitted optional field). The Dictionary terms
	// fold into the prompt, up to the local route's Whisper prompt budget, so local
	// recognition spells them the user's way. No model is named here (ADR-0180), so
	// none is passed: the budget question is answered by the route, and a local
	// model that takes no prompt has it stripped by the host either way.
	const language = app.settings.get('transcriptionLanguage');
	const prompt = recognizerPrompt(app, selectedService, null);
	const { data: outcome, error } =
		await tauri.transcription.transcribeRecording(audioBlobId, {
			language: language === 'auto' ? undefined : language,
			initialPrompt: prompt || undefined,
		});
	if (error) return Err(error);

	// Empty audio ran no model, so there is nothing to attribute and nothing to
	// report as applied. An empty transcript is the honest result.
	if (outcome.outcome === 'empty-audio') return Ok('');

	// The host names the exact model on every success. Logging it is what turns
	// an accidental substitution into something visible after the fact, and the
	// applied hints say which of the caller's requests actually reached the
	// recognizer: a prompt or language the active model cannot take is reported
	// rather than silently dropped, so "my Dictionary had no effect" has an
	// answer in the log instead of being a mystery.
	log.info('Local transcription complete', {
		modelId: outcome.modelId,
		applied: outcome.applied,
	});
	return Ok(outcome.text);
}

async function transcribeViaUpload(
	app: WhisperingApp,
	audioBlobId: BlobId,
	selectedService: UploadProviderId,
): Promise<Result<string, TranscriptionError>> {
	const { data: audio, error: loadError } = await loadForUpload(
		app,
		audioBlobId,
	);
	if (loadError) return Err(loadError);

	// `auto` language and an empty prompt map to the wire's "unset" (omitted from
	// the form). No per-provider key-format pre-check: no key just means no header,
	// and the server answers 401, surfaced as a RequestFailed carrying that detail.
	// The Dictionary terms fold into the prompt, up to whatever budget the selected
	// recognizer has, so cloud recognition spells them the user's way.
	// Narrowed here rather than in the workspace: the stored code is a plain string so
	// a hand-written union could never drift from `constants/languages.ts`, and a
	// code this release no longer supports falls back to letting the provider
	// detect the language rather than being sent through unchecked.
	const stored = app.settings.get('transcriptionLanguage');
	const spokenLanguage: SupportedLanguage = isSupportedLanguage(stored)
		? stored
		: 'auto';
	// The prompt is built inside each arm rather than above the switch, because one
	// provider's budget depends on which model it is pointed at and only the wire
	// arm resolves a model. A bespoke entry owns its model privately and none of
	// them is a Whisper decoder, so passing null there costs nothing.
	const entry = uploadDispatch(app)[selectedService];
	switch (entry.kind) {
		case 'wire': {
			const model = entry.model();
			const prompt = recognizerPrompt(app, selectedService, model);
			return await transcribe(audio, entry.resolve(), {
				model,
				language: spokenLanguage === 'auto' ? undefined : spokenLanguage,
				prompt: prompt || undefined,
			});
		}
		case 'bespoke':
			return entry.transcribe(audio, {
				prompt: recognizerPrompt(app, selectedService, null),
				spokenLanguage,
			});
	}
}
