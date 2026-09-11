import { defineErrors } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import type { TironianApp } from '$lib/app/app';
import { m } from '../paraglide/messages';

/**
 * Wispr Flow-style hands-free lock over push-to-talk: double-tap the hold
 * chord (two Pressed edges within {@link DOUBLE_TAP_WINDOW_MS}) and the mic
 * stays open past the second tap's own release; the next single press (or
 * whatever else ends the recording underneath us, see below) closes it.
 *
 * The gesture is only complete once the window has closed, so a Released that
 * lands inside the window does not stop anything yet: it holds its stop until
 * the instant the window expires. A second Pressed inside the window cancels
 * that held stop; a Pressed past the window runs it. A double-tap therefore
 * carries tap 1's recording straight through into the hands-free session as
 * one continuous capture. Acting on tap 1's release the moment it arrived
 * instead fed a sub-second fragment to the transcription pipeline on every
 * single latch: a paid call, a junk history row, and whatever the pipeline
 * then delivered. The deferral costs a real hold nothing, because a press held
 * past the window cannot be tap 1 of anything and still stops the instant it
 * is released.
 *
 * The held stop rides a webview `setTimeout`, and a hidden window aligns those
 * to roughly a second (Chromium background throttling; the once-a-minute tier
 * is for chained timers, not a one-shot like this). Push-to-talk is a global
 * command, so a hidden window is ordinary operating condition, and two things
 * keep that slack from mattering. Only a press shorter than the window ever
 * defers, so what a late stop lengthens is a gesture that captured no speech
 * either way, never a real dictation. And the next Pressed settles the held
 * stop itself instead of waiting on the timer, so slack can delay a stop but
 * cannot merge two dictations into one recording. The same bound covers the
 * synthetic Released `local-shortcut-manager.ts` fires on blur or on the page
 * going hidden: a sub-window hold ends on the timer, about a second after the
 * blur rather than on it.
 *
 * A thin wrapper rather than a change to `push-to-talk.ts`: that module owns
 * one press/release session and does not know about a two-tap pattern above
 * it, and it stays that way (its id-scoped, startup-safe session tracking is
 * exactly what the hands-free lock's `start`/`stop` calls lean on). This
 * module owns only the "is the next Released real" question; `push-to-talk.ts`
 * still owns everything about what a session is.
 *
 * Pure logic only: `createHandsFree` takes its `pushToTalk` slice as a
 * parameter rather than importing the real singleton itself, so this file has
 * no runtime dependency on `push-to-talk.ts` (`hands-free.test.ts` hands it a
 * mock controller directly). The production instance -- built over the real
 * `pushToTalk`, shared by the command handler and session teardown -- is
 * composed in `hands-free-instance.ts`. Importing the real `pushToTalk` here
 * too would make every importer of this module, including the test file,
 * eagerly load its dependency chain (`$lib/report`, `manual-recorder.svelte`,
 * `operations/recording`); `push-to-talk.test.ts` mocks those same modules via
 * `mock.module`, which replaces them for the rest of the `bun test` process,
 * so a stray real load from here left its mocks unable to take effect. The
 * only runtime imports here are the `wellcrafted` leaf helpers, which sit
 * outside that mocked chain; keep it that way if logging ever moves.
 */

export const DOUBLE_TAP_WINDOW_MS = 400;

const log = createLogger('tironian/hands-free');

const HandsFreeError = defineErrors({
	DeferredStopFailed: ({ cause }: { cause: unknown }) => ({
		message: m.hands_free_hands_free_deferred_push_to_talk_stop(),
		cause,
	}),
});

/** The slice of `pushToTalk` this wrapper drives. */
export type PushToTalkController = {
	start: (app: TironianApp) => Promise<void>;
	stop: (app: TironianApp) => Promise<void>;
	dispose: (app: TironianApp) => Promise<void>;
};

export function createHandsFree(controller: PushToTalkController) {
	let locked = false;
	// The previous Pressed's reading of the monotonic clock: set exactly while a
	// second Pressed could still complete a double-tap, and cleared once it
	// cannot (no press yet, or the streak was consumed by a lock, or the window
	// has closed on it). `performance.now()` and not `Date.now()` because every
	// use of it is an elapsed-gesture measurement: wall clock steps backward on
	// an NTP correction, a resume from sleep, or a user changing the system
	// clock, and a step landing between a Pressed and its Released would read as
	// a negative hold, which the "too long to be tap 1" guard below does not
	// catch and which would then hold the stop by the size of the step.
	let lastPressedAt: number | undefined;
	// The held stop: armed exactly while a Released is waiting to learn whether
	// it was tap 1, which can only be true with no lock open. It carries the app
	// whose release armed it, because what finally settles it is not always that
	// app's own edge. Four things settle it, each clearing `lastPressedAt` with
	// it: the timer itself, a Pressed past the window (which runs it), tap 2
	// (which cancels it), and `dispose` (which cancels it).
	let pendingStop:
		| { timer: ReturnType<typeof setTimeout>; app: TironianApp }
		| undefined;

	function cancelPendingStop() {
		if (pendingStop === undefined) return;
		clearTimeout(pendingStop.timer);
		pendingStop = undefined;
	}

	/**
	 * Run the held stop now, because the window has closed on it: either its own
	 * timer fired, or a press past the window overtook a timer that had not run
	 * yet. Not awaited, so a press following in this same tick is not held behind
	 * the stopped recording's transcription; `push-to-talk.ts` clears its session
	 * inside `stop`'s synchronous prefix, so that press still finds nothing to
	 * adopt and really starts. Log-only on failure, the same treatment
	 * `push-to-talk.ts` gives its cap: no caller is waiting on this stop.
	 */
	function settlePendingStop() {
		if (pendingStop === undefined) return;
		const { timer, app } = pendingStop;
		clearTimeout(timer);
		pendingStop = undefined;
		lastPressedAt = undefined;
		void controller
			.stop(app)
			.catch((cause) => log.warn(HandsFreeError.DeferredStopFailed({ cause })));
	}

	function onPressed(app: TironianApp) {
		const now = performance.now();

		if (locked) {
			// Third press: release the lock and stop the held-open recording.
			// Nothing can be held here: arming one needs an unlocked Released, and
			// the press that locked cancelled whatever was held before it.
			locked = false;
			lastPressedAt = undefined;
			return controller.stop(app);
		}

		if (
			lastPressedAt !== undefined &&
			now - lastPressedAt <= DOUBLE_TAP_WINDOW_MS
		) {
			// Second tap inside the window: lock hands-free open instead of
			// starting a normal timed streak over again. Tap 1's held stop is the
			// one thing that must not run: its recording is exactly what
			// hands-free keeps open, so cancel it rather than settle it.
			locked = true;
			lastPressedAt = undefined;
			cancelPendingStop();
			// `start` is idempotent either way `push-to-talk.ts` finds things:
			// tap 1's session is normally still live (its Released was deferred
			// and the cancel above just retired it), so this no-ops and
			// hands-free simply keeps that same recording going with no gap. It
			// really starts only when tap 1 left nothing to adopt -- its startup
			// failed, or its recording was ended by other means -- which is what
			// `push-to-talk.ts`'s stale-session check exists to notice.
			return controller.start(app);
		}

		// A press this far from the last one is a separate gesture with no claim
		// on the previous tap's recording, so a stop still held here is only one
		// the timer has not got to yet. Run it, never cancel it: cancelling
		// leaves tap 1's session live, the start below then no-ops onto it
		// (`push-to-talk.ts` returns early on a live session), and two
		// deliberately separate dictations land as one blob with the silence
		// between them inside it, with nothing to show it happened.
		settlePendingStop();
		lastPressedAt = now;
		return controller.start(app);
	}

	function onReleased(app: TironianApp) {
		// Locked: this Released belongs to a press we are deliberately
		// recording through (the second tap, or any stray release while
		// hands-free is open). Ignored, not stopped.
		if (locked) return;

		const heldFor =
			lastPressedAt === undefined
				? Number.POSITIVE_INFINITY
				: performance.now() - lastPressedAt;

		// Too long to be tap 1 of a double-tap, or a release with no press of
		// ours to measure (the unlocking third press cleared the streak before
		// its own release landed). Stopping now is what keeps a real hold's stop
		// instant: only presses shorter than the window ever wait.
		if (heldFor > DOUBLE_TAP_WINDOW_MS) {
			lastPressedAt = undefined;
			return controller.stop(app);
		}

		// A duplicated Released re-uses the schedule rather than arming a second
		// timer for the same question. Belt and braces on the stop count: a
		// re-arm would compute the same deadline anyway (the remainder is
		// anchored to the press, not to the release) and `settlePendingStop`
		// clears whichever timer the record holds, so only one stop could ever
		// run. What the guard buys is that no redundant timer is scheduled at
		// all, and that the schedule visibly belongs to the first release.
		if (pendingStop !== undefined) return;
		// The remainder of the window, measured from the press, not a fresh
		// window from the release: `onPressed` tests Pressed-to-Pressed, so this
		// expires at the same instant it stops accepting a press as tap 2. No
		// press can then find a stop held that it is no longer allowed to cancel.
		// The clock is monotonic, so the remainder is always within [0, window].
		pendingStop = {
			app,
			timer: setTimeout(settlePendingStop, DOUBLE_TAP_WINDOW_MS - heldFor),
		};
	}

	// Two known ways `locked` can end up stale (true with nothing recording),
	// both accepted rather than chased, because fixing them needs state that
	// `push-to-talk.ts` deliberately keeps private:
	// - The 5-minute cap fires while locked: it stops the recording (the same
	//   stuck-on safety fuse as an ordinary hold), but nothing here hears it,
	//   so `locked` stays true. The next press only unlocks; a second press
	//   starts again. Acceptable: the cap is a rare backstop, not a path a
	//   hands-free user takes often.
	// - Cancel (Escape/the cancel command) stops the recording directly
	//   through `manualRecorder`, bypassing `pushToTalk` entirely, so the same
	//   desync happens: `locked` outlives the recording it was guarding.

	async function dispose(app: TironianApp) {
		// A torn-down session should not leave the next one to start locked, nor
		// a held stop to fire against an app that is going away. Cancel it
		// rather than settle it: `controller.dispose` is the stronger stop and
		// ends that same recording itself, including one still starting. The
		// cancel stays in the synchronous prefix so the timer cannot fire
		// alongside the dispose it is racing.
		locked = false;
		lastPressedAt = undefined;
		cancelPendingStop();
		await controller.dispose(app);
	}

	return { onPressed, onReleased, dispose };
}
