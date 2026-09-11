/**
 * Hands-Free Push-to-Talk Tests
 *
 * Verifies the double-tap lock wrapper's edge logic in isolation from
 * `push-to-talk.ts`'s own session semantics (covered by `push-to-talk.test.ts`).
 * `createHandsFree` takes its `pushToTalk` slice as a parameter, so the mock
 * controller here is a plain object, not `mock.module('./push-to-talk')`: the
 * latter would replace that module for every test file in the same `bun test`
 * run, including `push-to-talk.test.ts`'s own import of the real thing.
 *
 * Key behaviors:
 * - A single short tap starts on Pressed and stops only once the double-tap
 *   window closes, so a tap that turns out to be tap 1 never stopped anything
 * - A press held past the window stops the instant it is released
 * - Two Pressed edges within the window lock hands-free open without ever
 *   stopping, and swallow the next Released
 * - A press while locked unlocks and stops, and clears the streak
 * - Two Pressed edges outside the window are treated as two independent taps,
 *   including when the held stop has not run yet: it is run, never cancelled
 * - The held stop is scheduled a window after the press, not after the release
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { TironianApp } from '$lib/app/app';
import { createHandsFree, DOUBLE_TAP_WINDOW_MS } from './hands-free';

const start = mock(async () => {});
const stop = mock(async () => {});
const dispose = mock(async () => {});
const handsFree = createHandsFree({ start, stop, dispose });
const app = {} as TironianApp;

beforeEach(() => {
	start.mockClear();
	stop.mockClear();
	dispose.mockClear();
	// Every test starts from a clean lock/streak, the same as a fresh UI
	// session would. It does double duty now that `dispose` cancels a held
	// stop: without it, a timer armed by one test would fire during the next
	// and corrupt its `stop` count. Do not "tidy" it away. It also means
	// `dispose` already has one call before any test body runs, which is why
	// the two dispose tests below assert a count rather than a bare
	// `toHaveBeenCalledWith(app)` that this call alone would satisfy.
	return handsFree.dispose(app);
});

test('a single short tap starts on Pressed and stops once the double-tap window closes', async () => {
	handsFree.onPressed(app);
	expect(start).toHaveBeenCalledTimes(1);

	handsFree.onReleased(app);
	expect(stop).toHaveBeenCalledTimes(0);

	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(1);
});

test('a press held past the window stops the instant it is released', async () => {
	handsFree.onPressed(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);

	handsFree.onReleased(app);
	expect(stop).toHaveBeenCalledTimes(1);
});

test('the held stop is scheduled a window after the press, not a window after the release', async () => {
	handsFree.onPressed(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS - 100);
	handsFree.onReleased(app); // held for the last ~100ms of the window

	// The remainder puts the stop at press + 400; a fresh window measured from
	// the release would put it at press + 700. Only the first has come due here,
	// so this is what fails if the delay ever regresses to a plain
	// `DOUBLE_TAP_WINDOW_MS`, which would leave a press that is already too late
	// to be tap 2 still able to reach a stop it no longer owns.
	await Bun.sleep(200);
	expect(stop).toHaveBeenCalledTimes(1);
});

test('a duplicated Released still stops exactly once, on the first release schedule', async () => {
	handsFree.onPressed(app);
	handsFree.onReleased(app);
	handsFree.onReleased(app); // a stray repeat of the same edge

	// Two things hold this together and the test does not distinguish them: the
	// re-arm guard in `onReleased`, and the fact that a re-arm would land on the
	// same deadline and be cleared by the same settle. That is the point: no
	// single line here can regress the stop count on its own.
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(1);
});

test('a double-tap locks without ever stopping, leaving no orphan capture', async () => {
	handsFree.onPressed(app); // tap 1
	handsFree.onReleased(app); // inside the window: held, not a stop
	expect(stop).toHaveBeenCalledTimes(0);

	handsFree.onPressed(app); // tap 2, inside the window: locks and cancels the held stop
	expect(stop).toHaveBeenCalledTimes(0);
	// Twice by design: `push-to-talk.ts` collapses the second into tap 1's
	// live session, and the call is what recovers when there is none.
	expect(start).toHaveBeenCalledTimes(2);

	handsFree.onReleased(app); // tap 2's release: swallowed
	expect(stop).toHaveBeenCalledTimes(0);

	// The window tap 1's release would have fired in has now passed.
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(0);
});

test('a press while locked unlocks and stops, without starting or leaving a stale streak', async () => {
	handsFree.onPressed(app); // tap 1
	handsFree.onReleased(app); // held
	handsFree.onPressed(app); // tap 2: locks
	expect(start).toHaveBeenCalledTimes(2);
	expect(stop).toHaveBeenCalledTimes(0);

	handsFree.onPressed(app); // tap 3: unlocks and stops
	expect(stop).toHaveBeenCalledTimes(1);
	expect(start).toHaveBeenCalledTimes(2); // the unlocking press does not also start

	// Tap 3's own release has no press of ours to measure, so it stops
	// straight away; a no-op at the controller, which already cleared.
	handsFree.onReleased(app);
	expect(stop).toHaveBeenCalledTimes(2);

	handsFree.onPressed(app); // an ordinary next tap
	expect(start).toHaveBeenCalledTimes(3);
	handsFree.onReleased(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(3);
});

test('two Pressed edges outside the window are two independent taps, not a lock', async () => {
	handsFree.onPressed(app); // tap 1
	handsFree.onReleased(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50); // the window closes: the held stop runs
	expect(stop).toHaveBeenCalledTimes(1);

	handsFree.onPressed(app); // tap 2, outside the window
	expect(start).toHaveBeenCalledTimes(2);
	handsFree.onReleased(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(2); // released normally, not swallowed
});

test('a press past the window runs a held stop that has not fired yet, rather than cancelling it', async () => {
	handsFree.onPressed(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS - 20);
	handsFree.onReleased(app); // arms for the last ~20ms of the window

	// Block the loop past the window's close, so the held stop is provably
	// still pending when the next press lands. A `Bun.sleep` would let the timer
	// run and prove nothing, and this is exactly the regime a hidden window's
	// timer alignment puts the callback in: due, but not yet run.
	Bun.sleepSync(60);

	handsFree.onPressed(app); // too late to be tap 2: a separate gesture
	// The first tap's stop ran instead of being discarded. Cancelling it here
	// would leave `push-to-talk.ts` holding a live session, the start below
	// would no-op onto it, and both dictations would land as one recording.
	expect(stop).toHaveBeenCalledTimes(1);
	expect(start).toHaveBeenCalledTimes(2);

	handsFree.onReleased(app);
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(2); // the second tap stops once, on its own schedule
});

test('dispose clears the lock so the next session does not start locked', async () => {
	handsFree.onPressed(app); // tap 1
	handsFree.onReleased(app);
	handsFree.onPressed(app); // tap 2: locks
	expect(start).toHaveBeenCalledTimes(2);

	await handsFree.dispose(app);
	expect(dispose).toHaveBeenCalledTimes(2); // the `beforeEach` teardown, then this one

	handsFree.onPressed(app); // a fresh session's first tap
	expect(start).toHaveBeenCalledTimes(3);
	handsFree.onReleased(app); // must stop, not be swallowed
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);
	expect(stop).toHaveBeenCalledTimes(1);
});

test('dispose retires a held stop rather than letting it fire against a torn-down app', async () => {
	handsFree.onPressed(app);
	handsFree.onReleased(app); // held

	await handsFree.dispose(app); // `controller.dispose` is the stronger stop
	await Bun.sleep(DOUBLE_TAP_WINDOW_MS + 50);

	expect(stop).toHaveBeenCalledTimes(0);
	expect(dispose).toHaveBeenCalledTimes(2); // the `beforeEach` teardown, then this one
});
