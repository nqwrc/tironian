import {
	type AnyTaggedError,
	defineErrors,
	type InferErrors,
} from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import type { VadState } from '$lib/constants/audio';
import type { DeliveryReach } from '$lib/operations/delivery';
import { manualRecorder } from '$lib/state/manual-recorder.svelte';
import { vadRecorder } from '$lib/state/vad-recorder.svelte';

/**
 * The dictation lifecycle owned by the main window. See ADR-0039.
 *
 * Voice-activated capture is *continuous*: an utterance transcribes while the
 * session keeps listening, so a live meter and a pipeline outcome run at once.
 * Manual capture is sequential. Two facts keep both honest:
 *
 * - `capture` is *derived* from the recorder machines: the live session, with no
 *   second copy of "are we recording" to drift.
 * - `outcome` is the most-recent utterance's pipeline result, an ephemeral signal
 *   the pipeline drives. Most-recent-wins: a new utterance overwrites it, and the
 *   OS-notification path reads it and wants each distinct failure exactly once.
 *
 * A failure is transient here, not a held state: the pill glances it (manual),
 * the OS notification fires for it, and the recordings row is the durable
 * record. The pill is not a review surface, so there is no failure latch.
 */
export type DictationCapture =
	| { kind: 'idle' }
	| { kind: 'recording'; trigger: 'manual' }
	| { kind: 'recording'; trigger: 'vad'; vadState: Exclude<VadState, 'IDLE'> };

export type DictationOutcome =
	| { kind: 'none' }
	| { kind: 'transcribing' }
	| { kind: 'polishing' }
	| { kind: 'delivered'; reach: DeliveryReach; wordCount?: number }
	| { kind: 'withheld' }
	| ({ kind: 'failed' } & DictationFailure);

export type DictationLifecycle = {
	capture: DictationCapture;
	outcome: DictationOutcome;
};

/** Where a dictation failed, which determines how loudly feedback surfaces it. */
export type DictationFailureTier = 'silent-loss' | 'transcription';

/** A dictation failure, carrying the live error object for the projection. */
export type DictationFailure = {
	tier: DictationFailureTier;
	error: AnyTaggedError;
};

const log = createLogger('tironian/dictation-lifecycle');

/**
 * The one failure this lifecycle logs. `markFailed` is the funnel every
 * dictation failure passes through, and the tier says where it happened.
 */
export const DictationLifecycleError = defineErrors({
	DictationFailed: ({
		tier,
		cause,
	}: {
		tier: DictationFailureTier;
		cause: AnyTaggedError;
	}) => ({
		message: `Dictation failed (${tier})`,
		tier,
		cause,
	}),
});
export type DictationLifecycleError = InferErrors<
	typeof DictationLifecycleError
>;

// How long a clean delivery's checkmark flashes before the outcome retires to
// `none`. Sub-second: the transcribed text landing is the real receipt, so this
// is a glance confirming it, not a notice to read. Only the clean `output` reach
// flashes; a reduced reach persists instead (see `markDelivered`). (A live VAD
// session projects `delivered` to no pip, so this flash only ever shows once
// capture is idle.)
const DELIVERED_FLASH_MS = 900;

// How long a failure holds the pill before the outcome retires to `none`.
// Longer than a delivery's glance, because a failure is unexpected and there is
// no landed text to corroborate it, but still bounded: the floating HUD is
// always on top, so an outcome that never retires leaves an empty capsule
// covering whatever the user moved on to. The durable records are the
// recordings row and the OS notification, neither of which this timer touches.
const FAILED_FLASH_MS = 2000;

function createDictationLifecycle() {
	// The outcome track is the ephemeral signal directly: `none` when no utterance
	// is in flight, otherwise the most-recent utterance's phase. Reset to `none`
	// when a new dictation begins so a stale `failed` never lingers past the next
	// attempt.
	let outcome = $state.raw<DictationOutcome>({ kind: 'none' });
	let retireTimer: ReturnType<typeof setTimeout> | undefined;

	function clearRetireTimer() {
		clearTimeout(retireTimer);
		retireTimer = undefined;
	}

	/** Retire `outcome` to `none` after `delay`, unless a newer outcome took over. */
	function retireAfter(delay: number, kind: DictationOutcome['kind']) {
		retireTimer = setTimeout(() => {
			retireTimer = undefined;
			if (outcome.kind === kind) outcome = { kind: 'none' };
		}, delay);
	}

	// The live session, read straight off the recorder machines. The pill owner is
	// the most-recent dictation, so a manual recording and a VAD session never
	// both report `recording` (only one recorder is live at a time).
	const capture = $derived.by((): DictationCapture => {
		if (manualRecorder.state === 'RECORDING')
			return { kind: 'recording', trigger: 'manual' };
		if (
			vadRecorder.state === 'LISTENING' ||
			vadRecorder.state === 'SPEECH_DETECTED'
		)
			return { kind: 'recording', trigger: 'vad', vadState: vadRecorder.state };
		return { kind: 'idle' };
	});

	const current = $derived<DictationLifecycle>({ capture, outcome });

	return {
		/** The current lifecycle facts. Read reactively to project them. */
		get current(): DictationLifecycle {
			return current;
		},

		/**
		 * Retire the outcome track: no dictation is worth showing.
		 *
		 * Two callers mean the same thing by it. A new dictation is starting, so
		 * the last one's terminal outcome must not linger into this attempt; or an
		 * attempt produced no words at all, and a person who said nothing should
		 * see nothing rather than a receipt for it (`operations/pipeline.ts`).
		 * Only the outcome is cleared, never the live capture.
		 */
		reset(): void {
			clearRetireTimer();
			outcome = { kind: 'none' };
		},

		/** The recorder stopped (or a VAD utterance ended); now transcribing. */
		markTranscribing(): void {
			clearRetireTimer();
			outcome = { kind: 'transcribing' };
		},

		/**
		 * The transcript landed and the always-on Polish pass is now running over it
		 * (ADR-0099). Held until `markDelivered`, with a `ship-raw` control on the
		 * pill to skip it. Only entered when a Polish pass actually runs (a usable
		 * provider, Polish on); speed mode goes straight from transcribing to
		 * delivered.
		 */
		markPolishing(): void {
			clearRetireTimer();
			outcome = { kind: 'polishing' };
		},

		/**
		 * The transcript landed. `reach` is how far it got toward the configured
		 * output: either a clean `output` or a `clipboard` fallback. Both reaches are
		 * successes because the text is saved, so neither is a dictation failure.
		 *
		 * A clean `output` flashes for a beat and retires: the landing text is the
		 * receipt, so the pill is just a glance. The reduced `clipboard` reach instead
		 * persists until the next dictation, like a failure does:
		 * the text did not land where the user asked, so the tag carries information
		 * the text alone does not, and a sub-second flash is too easy to miss. There
		 * is no notification for a reduced reach (ADR-0039): the persistent pill tag
		 * and the recordings row are the surfaces, and a revoked Accessibility grant
		 * already raises its own standing notice.
		 *
		 * `wordCount` is the delivered text's word count, optional so a caller that
		 * has no text handy (tests, future callers) can omit it; the pill falls
		 * back to a plain "Delivered" label when absent.
		 */
		markDelivered(reach: DeliveryReach, wordCount?: number): void {
			clearRetireTimer();
			outcome = { kind: 'delivered', reach, wordCount };
			// Only the clean reach auto-retires; a reduced reach stays put.
			if (reach !== 'output') return;
			retireAfter(DELIVERED_FLASH_MS, 'delivered');
		},

		/**
		 * The secure-field guard withheld delivery: a password field had focus at
		 * paste time, so the transcript went only to history, with nothing at the
		 * cursor and nothing on the clipboard. Persists until the next dictation,
		 * like a reduced reach: no landed text corroborates this outcome, so the
		 * pill tag is the only explanation the user gets.
		 */
		markWithheld(): void {
			clearRetireTimer();
			outcome = { kind: 'withheld' };
		},

		/** A dictation failed: glance the failure, then retire to `none`.
		 *
		 * Transient, not a held state: the pill glances it (manual), the
		 * notification path fires it, and the recordings row is the durable record.
		 * The retirement is here rather than in the pill component because the
		 * desktop pill does not own its own visibility. It draws into an
		 * always-on-top overlay window whose show/hide is driven by this outcome
		 * projecting to `null`, so a component-local fade cleared the drawn content
		 * and left an empty capsule floating over the user's screen until the next
		 * dictation. Retiring at the source is the one place every surface agrees:
		 * the window hides, the pill clears, and the web indicator does the same.
		 *
		 * The OS notification is unaffected, because it fires on the failure's error
		 * identity rather than on the outcome persisting. */
		markFailed(failure: DictationFailure): void {
			// Log here rather than at each call site, because this is the funnel every
			// failure already passes through, so a new failure path cannot be added
			// without one. Nothing else writes the cause down: the pill renders the
			// tier's label and drops the error, and the OS notification carries the
			// message but only if notifications are permitted and seen. Without this
			// line a failed dictation leaves no trace to read afterwards.
			//
			log.warn(
				DictationLifecycleError.DictationFailed({
					tier: failure.tier,
					cause: failure.error,
				}),
			);
			clearRetireTimer();
			outcome = { kind: 'failed', ...failure };
			retireAfter(FAILED_FLASH_MS, 'failed');
		},
	};
}

export const dictationLifecycle = createDictationLifecycle();
