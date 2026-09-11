import { NonRealTimeVAD } from '@ricky0123/vad-web';
import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import { DEFAULT_VAD_ASSET_PATH } from './vad-recorder';

const log = createLogger('tironian/recorder/speech-gate');

const SpeechGateError = defineErrors({
	/** The gate could not run, so the caller was told there was speech. */
	Unavailable: ({ cause }: { cause: unknown }) => ({
		message: `Could not check the recording for speech, so it was treated as speech: ${extractErrorMessage(cause)}`,
		cause,
	}),
});

/**
 * Ask whether a finished recording contains any speech at all.
 *
 * This exists because Whisper does not decline to answer. It is an
 * autoregressive decoder trained on hundreds of thousands of hours of web audio
 * paired with subtitles, and in that data the silent stretches are captioned
 * with pleasantries: "Thank you.", "Thanks for watching!", subscribe outros.
 * Hand it a second of silence and it has no acoustic evidence to constrain the
 * output, so it emits the highest-prior caption instead of nothing. A user who
 * taps push-to-talk and says nothing gets "Thank you." pasted at their cursor.
 * The fix has to happen before the model, because the model has no way to say
 * "there was nothing there".
 *
 * Deliberately Silero rather than an amplitude threshold. A dB floor cannot tell
 * quiet speech from loud silence, so any floor set high enough to catch a noisy
 * room also cuts the person speaking softly late at night, and dropping real
 * dictation is far worse than the artifact being fixed. Silero is an actual
 * speech detector, so it keeps the quiet talker and rejects the empty room.
 * It is already this package's dependency and its assets already ship, so the
 * accurate answer costs no more to deliver than the crude one.
 *
 * What this does not do: a gate on speech is not a gate on *your* speech. A
 * television, a passing conversation, or a call on speaker is speech, passes
 * here, and reaches the recognizer. This removes the silence artifact; it is
 * not noise suppression.
 */

/**
 * Whether `audio` contains speech, defaulting to `true` whenever the question
 * cannot be answered.
 *
 * Every failure path returns `true` on purpose. A gate that errors closed
 * silently discards recordings, which is strictly worse than the hallucination
 * it was added to prevent: the artifact is visible and correctable, a swallowed
 * dictation is neither. So a model that will not load, audio that will not
 * decode, and inference that throws all mean "transcribe it" and never "drop
 * it". Do not invert this to make a caller simpler.
 *
 * @param assetBaseUrl Where the Silero model and onnxruntime wasm are served.
 * The default suits an app at the origin root; one served under a prefix must
 * pass its own, exactly as `createVadRecorder` requires.
 */
export async function containsSpeech({
	audio,
	assetBaseUrl = DEFAULT_VAD_ASSET_PATH,
}: {
	audio: Blob;
	assetBaseUrl?: string;
}): Promise<boolean> {
	try {
		const samples = await decodeToMono(audio);
		// An empty decode is the one negative answer that needs no model: there
		// are no samples to find speech in.
		if (samples.pcm.length === 0) return false;

		const vad = await NonRealTimeVAD.new({
			// Named explicitly, and legacy rather than v5, because `NonRealTimeVAD`
			// builds `SileroLegacy` unconditionally and takes no model option: the
			// live recorder's `model: 'v5'` has no counterpart here. The default
			// URL resolves against the package's own asset path, which is not where
			// a consuming app serves these, so it has to be spelled out.
			modelURL: `${assetBaseUrl}silero_vad_legacy.onnx`,
			// The live recorder hands vad-web an `onnxWASMBasePath` and lets it set
			// `wasmPaths`, but that option belongs to the real-time options type
			// alone; offline, `ortConfig` is the only hook, so point onnxruntime at
			// the same directory by hand. Without it, onnxruntime falls back to
			// fetching its wasm from a CDN, which is both a network dependency this
			// app does not want and a failure on a machine that is offline.
			ortConfig: (ort) => {
				ort.env.wasm.wasmPaths = assetBaseUrl;
				ort.env.logLevel = 'error';
			},
		});

		// The first segment settles it. `run` is a generator over every speech
		// span it finds, and this asks only whether one exists, so stop at the
		// first rather than paying for the rest of the clip.
		for await (const _segment of vad.run(samples.pcm, samples.sampleRate)) {
			return true;
		}
		return false;
	} catch (cause) {
		// Failing open is correct; failing open in silence is not. A gate that
		// cannot run looks identical from the outside to a gate that ran and found
		// speech, so without this line the only symptom of a broken gate is the
		// hallucinated transcript it was added to prevent, and the only way to
		// discover it is a user reporting the original bug. Say so once, here.
		log.warn(SpeechGateError.Unavailable({ cause }));
		return true;
	}
}

/**
 * Decode a recording to mono PCM.
 *
 * `OfflineAudioContext` rather than `AudioContext` because this only needs the
 * decoder: an `AudioContext` opens an output device, which on some platforms
 * lights the app up as playing audio and can be refused outright before a user
 * gesture. Channel 0 is enough, since Silero takes one channel and a recorder's
 * capture is mono in practice anyway. The sample rate is carried out with the
 * samples because `run` resamples to what the model wants and needs to be told
 * what it was given.
 */
async function decodeToMono(
	audio: Blob,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
	const context = new OfflineAudioContext({
		numberOfChannels: 1,
		length: 1,
		sampleRate: 16_000,
	});
	const buffer = await context.decodeAudioData(await audio.arrayBuffer());
	return { pcm: buffer.getChannelData(0), sampleRate: buffer.sampleRate };
}
