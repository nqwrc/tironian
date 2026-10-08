/**
 * The FIFO of what each capture in flight took at its start (ADR-0272 added
 * the text around the cursor to the foreground app it already held). Generic
 * over the entry so this file has no runtime import and its test mocks
 * nothing; the production entry type and its reads live in `recording.ts`.
 *
 * Every path that begins an entry must take or discard exactly that entry, so
 * a capture that never reaches a pipeline cannot leave one behind for the next
 * capture to inherit, and cannot remove another capture's.
 */
export type CaptureQueue<T> = {
	/** Appends `entry` and returns it, so a caller can remove that exact one. */
	begin: (entry: T) => T;
	/** The oldest entry, removed; `empty` when there is none. */
	take: () => T;
	/** Removes `entry` wherever it sits. `null` and an entry already gone do nothing. */
	discard: (entry: T | null) => void;
	/** Removes the oldest entry, for a path that has no entry of its own. */
	discardOldest: () => void;
};

export function createCaptureQueue<T>(empty: T): CaptureQueue<T> {
	const pending: T[] = [];
	return {
		begin: (entry) => {
			pending.push(entry);
			return entry;
		},
		take: () => pending.shift() ?? empty,
		discard: (entry) => {
			if (entry === null) return;
			const index = pending.indexOf(entry);
			if (index !== -1) pending.splice(index, 1);
		},
		discardOldest: () => {
			pending.shift();
		},
	};
}

/**
 * Begins the entry for a manual start. While a manual recording is live or
 * starting, a second start is a no-op that fails, so nothing is read and
 * nothing is queued: the read would hit the host for a dictation that never
 * exists, and its entry would wait behind the live recording's. Returns `null`
 * then.
 */
export function beginManualCapture<T>(
	queue: CaptureQueue<T>,
	manualRecordingLive: boolean,
	read: () => T,
): T | null {
	return manualRecordingLive ? null : queue.begin(read());
}
