/**
 * Transcription Deadline Tests
 *
 * Transcription had no ceiling on any of its six routes, and serializing
 * pipeline runs raised the price of that: a route that never answered held
 * every later utterance behind it, with the pill stuck on "Transcribing..."
 * and nothing written to the row.
 *
 * Key behaviors:
 * - An expired wait is a failure, never an empty transcript, because the
 *   pipeline reads an empty transcript as "nothing was said" and retires the
 *   pill without reporting anything
 * - The copy names the duration and the one recovery there is, since unlike a
 *   polish pass there is no raw text to fall back on
 * - A live dictation waits less than an import or a retry, and a manual
 *   capture too long to be judged by the dictation ceiling is not judged by it
 * - The race answers with the expiry when the run never settles, and gets out
 *   of the way when it does
 *
 * The module holds only the decision and the race, so it imports with no mocks
 * at all; `transcribe.ts` needs auth, tauri, blobs, secrets, deviceConfig,
 * analytics and report before it can be loaded. Same division as
 * `completionTimedOut` and `decideSecureFieldGuard`.
 */
import { expect, test } from 'bun:test';
import {
	BATCH_TRANSCRIPTION_TIMEOUT_MS,
	DICTATION_TRANSCRIPTION_TIMEOUT_MS,
	deadlineForCapture,
	transcriptionTimedOut,
	transcriptionTimeoutMs,
	withDeadline,
} from './transcription-deadline.js';

/**
 * The destructive alternative, and the reason this is asserted first.
 * `transcribeAudio` returns `Ok('')` twice on purpose (the silence gate, and a
 * host reporting `empty-audio`), and the pipeline treats an empty transcript as
 * a person who said nothing: `dictationLifecycle.reset()`, no report, no toast.
 * A timeout that answered `Ok('')` would discard the dictation in silence.
 */
test('an expired wait is a failure, not an empty transcript', () => {
	const result = transcriptionTimedOut('dictation');

	expect(result.data).toBeNull();
	expect(result.error?.name).toBe('TranscriptionTimedOut');
});

test('the failure names the duration it waited and the way back', () => {
	const message = transcriptionTimedOut('dictation').error?.message ?? '';

	expect(message).toContain('within 5 minutes');
	expect(message).toContain('retry it from the recordings list');
});

/**
 * The whole reason the deadline takes a situation rather than a number. A live
 * dictation is the case the run queue serializes and the case with a person
 * watching a cursor; an import can legitimately hold close to an hour of audio
 * and be transcribed locally.
 */
test('a live dictation waits less than an import or a retry', () => {
	expect(transcriptionTimeoutMs('dictation')).toBe(
		DICTATION_TRANSCRIPTION_TIMEOUT_MS,
	);
	expect(transcriptionTimeoutMs('batch')).toBe(BATCH_TRANSCRIPTION_TIMEOUT_MS);
	expect(DICTATION_TRANSCRIPTION_TIMEOUT_MS).toBeLessThan(
		BATCH_TRANSCRIPTION_TIMEOUT_MS,
	);
});

test('a file import takes the generous deadline', () => {
	expect(
		deadlineForCapture({ isDictation: false, audioDurationMs: null }),
	).toBe('batch');
});

/**
 * VAD reports no duration (`recording.ts` passes null), and that is the right
 * answer for it: an utterance is short by construction, so the absence of a
 * number is not a reason to stop treating it as a dictation.
 */
test('a VAD utterance with no reported duration stays a dictation', () => {
	expect(deadlineForCapture({ isDictation: true, audioDurationMs: null })).toBe(
		'dictation',
	);
});

test('a short manual capture is a dictation', () => {
	expect(
		deadlineForCapture({ isDictation: true, audioDurationMs: 8_000 }),
	).toBe('dictation');
});

/**
 * The case `isDictation` alone gets wrong. Manual record has no length bound, so
 * a meeting recorded with the record button arrives as `deliverySource:
 * 'recording'`. Judging twenty minutes of audio by a five-minute ceiling would
 * expire on work that was going to succeed, which is the failure the generous
 * ceiling exists to avoid.
 */
test('a manual capture longer than the dictation ceiling takes the generous one', () => {
	expect(
		deadlineForCapture({
			isDictation: true,
			audioDurationMs: DICTATION_TRANSCRIPTION_TIMEOUT_MS + 1,
		}),
	).toBe('batch');
});

test('the race answers with the expiry when the run never settles', async () => {
	const answer = await withDeadline(
		1,
		() => 'expired',
		() => new Promise<string>(() => undefined),
	);

	expect(answer).toBe('expired');
});

test('a run that finishes is passed through untouched', async () => {
	const answer = await withDeadline(
		60_000,
		() => 'expired',
		async () => 'transcript',
	);

	expect(answer).toBe('transcript');
});

/**
 * Nothing under this deadline is cancellable, so the abandoned run is still
 * running after the caller has been told the wait expired. Whatever it does
 * next must not reach the caller, and must not surface as an unhandled
 * rejection either.
 */
test('a rejection from the abandoned run does not disturb the answer', async () => {
	const answer = await withDeadline(
		1,
		() => 'expired',
		() =>
			new Promise<string>((_resolve, reject) => {
				setTimeout(() => reject(new Error('late failure')), 20);
			}),
	);
	await new Promise((resolve) => setTimeout(resolve, 40));

	expect(answer).toBe('expired');
});
