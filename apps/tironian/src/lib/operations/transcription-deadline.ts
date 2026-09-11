/**
 * The transcription deadline: how long a caller waits, and the failure it sees
 * when that runs out.
 *
 * Split from `operations/transcribe.ts` for the same reason `completionTimedOut`
 * sits apart from the request it bounds: the decision is pure, so it is tested
 * with no mocks, while the timer stays in the impure caller. Importing
 * `transcribe.ts` at all requires auth, tauri, blobs, secrets, deviceConfig,
 * analytics and report to be stood up first.
 *
 * Unlike the completion deadline, there is nothing to degrade to. A polish pass
 * that expires ships the raw transcript; a transcription that expires has no
 * text at all. So the ceiling has to be a real ceiling for a call that is never
 * coming back, never a latency budget, and the copy carries the only recovery
 * there is: the audio is already saved, so the row can be retried.
 */
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';

/**
 * Which situation is waiting, which is what sets the ceiling.
 *
 * `dictation` is a live capture with a person watching the pill and a cursor
 * waiting for text: VAD utterances and manual stop. It is also the only one the
 * run queue serializes, so a run that never returns holds every later utterance
 * behind it. Both halves argue for the tighter number.
 *
 * `batch` is a file import or a retry from the recordings list. Nobody is
 * waiting at a cursor, and the audio can be far longer: import accepts up to
 * `MAX_IMPORT_FILE_SIZE` (25 MB), which is roughly fifty minutes of compressed
 * speech. A retry is not even in the queue, so its ceiling guards nothing but
 * the row itself; it takes the generous number rather than pretending otherwise.
 */
export type TranscriptionDeadline = 'dictation' | 'batch';

/**
 * Five minutes for a live dictation.
 *
 * The binding case is not a VAD utterance (seconds) but a long push-to-talk on
 * the slowest local route. The catalog is Whisper Tiny, Whisper Small Q4 and
 * Parakeet 0.6B (`transcription/catalog.rs`), all of which run well faster than
 * realtime; there is no large model to be slow with. A cloud round trip over a
 * dictation-sized clip is seconds. Five minutes clears every one of those by an
 * order of magnitude, which is the point: expiring should mean broken, not slow.
 */
export const DICTATION_TRANSCRIPTION_TIMEOUT_MS = 5 * 60_000;

/**
 * An hour for an import or a retry.
 *
 * A 25 MB import can hold close to an hour of audio, and the on-device route
 * transcribes it locally, so a legitimate run here is minutes and can plausibly
 * be tens of them on old hardware. A tight ceiling would kill work that was
 * going to succeed, and killing a long import is worse than waiting for it,
 * because there is no partial transcript to keep. This bound exists so a hung
 * import cannot hold the queue forever, not to make imports feel responsive.
 */
export const BATCH_TRANSCRIPTION_TIMEOUT_MS = 60 * 60_000;

export function transcriptionTimeoutMs(
	deadline: TranscriptionDeadline,
): number {
	return deadline === 'dictation'
		? DICTATION_TRANSCRIPTION_TIMEOUT_MS
		: BATCH_TRANSCRIPTION_TIMEOUT_MS;
}

/**
 * Which deadline one pipeline run takes.
 *
 * `isDictation` is not enough on its own. It is true for a VAD utterance, which
 * is short by construction, and equally true for manual record, which has no
 * length bound at all: someone can press record, sit through a meeting, and
 * press stop. The dictation ceiling is generous next to a few seconds of speech
 * and meaningless next to twenty minutes of it, so a manual capture that long
 * would expire on work that was going to succeed, which is the exact failure the
 * batch ceiling exists to avoid.
 *
 * So a capture longer than the dictation ceiling itself takes the batch one. The
 * threshold is that ceiling rather than a new number, because the claim is
 * precisely that audio outrunning the whole budget cannot be judged by it. Manual
 * stop is the only path that reports a duration; VAD and import both pass null,
 * and for VAD that is right, since those clips are short by construction.
 *
 * The residual is a manual capture of a few minutes on unusually slow hardware,
 * under the threshold but over the ceiling once transcribed. It fails visibly and
 * the row retries under the generous ceiling, which is the same recovery every
 * other expiry has.
 */
export function deadlineForCapture({
	isDictation,
	audioDurationMs,
}: {
	isDictation: boolean;
	audioDurationMs: number | null;
}): TranscriptionDeadline {
	if (!isDictation) return 'batch';
	if (
		audioDurationMs !== null &&
		audioDurationMs > DICTATION_TRANSCRIPTION_TIMEOUT_MS
	) {
		return 'batch';
	}
	return 'dictation';
}

export const TranscriptionDeadlineError = defineErrors({
	/**
	 * The wait ran out. Deliberately an error and never `Ok('')`: an empty
	 * transcript is a real outcome in this app (the silence gate, and a host
	 * reporting `empty-audio`), and the pipeline reads one as "nothing was said",
	 * retiring the pill with no report at all. Returning empty text here would
	 * throw the dictation away without telling anyone.
	 */
	TranscriptionTimedOut: ({ timeoutMs }: { timeoutMs: number }) => ({
		message: `Transcription did not finish within ${Math.round(timeoutMs / 60_000)} minutes. The recording is saved, so you can retry it from the recordings list.`,
		timeoutMs,
	}),
});
export type TranscriptionDeadlineError = InferErrors<
	typeof TranscriptionDeadlineError
>;

/**
 * The failure for an expired wait, carrying the ceiling that expired.
 *
 * Owning the copy is what makes the notice worth reading. There is no
 * underlying rejection to surface anyway (nothing under this deadline is
 * cancellable), and a bare "transcription failed" would name no duration and no
 * recovery, leaving the person unsure whether waiting longer would have helped.
 */
export function transcriptionTimedOut(
	deadline: TranscriptionDeadline,
): Result<string, TranscriptionDeadlineError> {
	return TranscriptionDeadlineError.TranscriptionTimedOut({
		timeoutMs: transcriptionTimeoutMs(deadline),
	});
}

/**
 * Race a run against a wall-clock ceiling, answering with `onExpiry()` when the
 * ceiling wins.
 *
 * Abandon, not cancel, and that distinction is the honest part: nothing under
 * this deadline takes an `AbortSignal`. `transcribe()` in `@tironian/client`
 * has no signal parameter, `HttpService.post` (Deepgram, ElevenLabs) has none,
 * Mistral goes through its own SDK, and the on-device route is a Tauri
 * `invoke`, which cannot be cancelled at all. So the work keeps running; what
 * ends is the waiting for it.
 *
 * Generic over the answer, and taking the ceiling in milliseconds rather than
 * reading it from a `TranscriptionDeadline`, so the race itself can be tested
 * in milliseconds instead of being asserted structurally or waited out.
 */
export async function withDeadline<T>(
	timeoutMs: number,
	onExpiry: () => T,
	run: () => Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(onExpiry()), timeoutMs);
	});
	const running = run();
	// The abandoned run outlives this race. Swallow a late rejection so letting
	// go of it cannot surface as an unhandled rejection long after the caller
	// was told the wait expired.
	running.catch(() => undefined);
	try {
		return await Promise.race([running, expiry]);
	} finally {
		clearTimeout(timer);
	}
}
