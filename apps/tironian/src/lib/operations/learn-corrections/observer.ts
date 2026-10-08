/**
 * One open observation at a time, from a cursor paste to a stable read or
 * 85 seconds, whichever comes first (plan: "When to observe"). Holds the
 * delivered text and the previous read's candidate folds; every span is a
 * local that goes out of scope with its comparison (ADR-0271).
 */
import type { FieldRead } from '../field-read';
import {
	type Decision,
	decideLearning,
	extractCandidates,
	type KnownTerms,
	LIMITS,
} from './rules';
import { tokenizeWords } from './words';

export const OBSERVATION_SCHEDULE = {
	baselineMs: 1000,
	baselineRetryMs: 3000,
	/** The last check lands inside the host's 90 s deadline, which starts at the paste. */
	checksMs: [15_000, 45_000, 85_000],
	/** Longer pastes are documents; the host refuses them too. */
	maxDeliveredUnits: 4000,
} as const;

/** Whether a delivery is worth observing at all. The pipeline asks before it delivers. */
export function shouldObserve(delivered: string): boolean {
	return (
		delivered.length <= OBSERVATION_SCHEDULE.maxDeliveredUnits &&
		tokenizeWords(delivered).length >= LIMITS.minDeliveredWords
	);
}

export type ObserverDeps = {
	read(): Promise<FieldRead>;
	/**
	 * Drops the host's paste target with this generation, the last one a read
	 * reported; `null` when no read has named it yet.
	 */
	end(generation: number | null): void;
	schedule(ms: number, run: () => void): () => void;
	enabled(): boolean;
	hash(fold: string): Promise<string>;
	known(): KnownTerms;
	learn(decision: Decision): void;
};

type Observation = {
	delivered: string;
	/** The host target this observation reads, once any read has named it. */
	generation: number | null;
	baselined: boolean;
	lastKey: string | null;
	busy: boolean;
	cancels: (() => void)[];
};

type Trigger = 'timer' | 'final' | 'nextDictation';

export function createCorrectionObserver(deps: ObserverDeps) {
	let current: Observation | null = null;

	/** Forget the observation without touching the host: a newer paste already replaced its target. */
	function drop(): void {
		for (const cancel of current?.cancels ?? []) cancel();
		current = null;
	}

	function close(): void {
		if (current === null) return;
		const { generation } = current;
		drop();
		deps.end(generation);
	}

	/**
	 * Remembers which host target this observation reads. A read that names a
	 * different one spent a newer paste's target, not ours: its span is not ours
	 * either, and closing must end only our own.
	 */
	function ours(o: Observation, read: FieldRead): boolean {
		if (read.generation === null) return true;
		o.generation ??= read.generation;
		return read.generation === o.generation;
	}

	/** Any failure means no learning (invariant 7). */
	function run(o: Observation, task: () => Promise<void>): void {
		task().then(undefined, () => {
			if (current === o) close();
		});
	}

	async function baseline(o: Observation, attempt: 1 | 2): Promise<void> {
		if (current !== o) return;
		if (!deps.enabled()) return close();
		const read = await deps.read();
		if (current !== o) return;
		if (!ours(o, read)) return close();
		if (read.kind === 'span') {
			o.baselined = true;
			return;
		}
		if (attempt === 2) return close();
		o.cancels.push(
			deps.schedule(
				OBSERVATION_SCHEDULE.baselineRetryMs - OBSERVATION_SCHEDULE.baselineMs,
				() => run(o, () => baseline(o, 2)),
			),
		);
	}

	async function check(o: Observation, trigger: Trigger): Promise<void> {
		if (current !== o) return;
		if (o.busy) {
			// The next dictation needs the previous stable read to compare with,
			// and that read is still in flight. Losing the lesson costs nothing.
			// The final check is the last chance: a stalled read must not leave
			// the observation open past it.
			if (trigger !== 'timer') close();
			return;
		}
		if (!o.baselined || !deps.enabled()) return close();
		o.busy = true;
		const read = await deps.read();
		o.busy = false;
		if (current !== o) return;
		if (!ours(o, read)) return close();
		if (read.kind !== 'span') return close();
		const extraction = extractCandidates(o.delivered, read.region, {
			atFieldStart: read.before === '',
		});
		if (extraction.kind !== 'candidates') return close();
		const key = extraction.candidates
			.map((c) => c.fold)
			.sort()
			.join('\u0000');
		const stable = o.lastKey !== null && key === o.lastKey;
		if (stable && extraction.candidates.length > 0) {
			const hashed = await Promise.all(
				extraction.candidates.map(async (c) => ({
					...c,
					hash: await deps.hash(c.fold),
				})),
			);
			if (current !== o) return;
			const decision = decideLearning(hashed, deps.known());
			if (decision.create.length > 0 || decision.promote.length > 0)
				deps.learn(decision);
			return close();
		}
		if (trigger !== 'timer') return close();
		o.lastKey = key;
	}

	return {
		open({ delivered }: { delivered: string }): void {
			drop();
			if (!deps.enabled() || !shouldObserve(delivered)) {
				deps.end(null);
				return;
			}
			const o: Observation = {
				delivered,
				generation: null,
				baselined: false,
				lastKey: null,
				busy: false,
				cancels: [],
			};
			current = o;
			o.cancels.push(
				deps.schedule(OBSERVATION_SCHEDULE.baselineMs, () =>
					run(o, () => baseline(o, 1)),
				),
			);
			const checks = OBSERVATION_SCHEDULE.checksMs;
			checks.forEach((ms, index) => {
				const trigger: Trigger =
					index === checks.length - 1 ? 'final' : 'timer';
				o.cancels.push(
					deps.schedule(ms, () => run(o, () => check(o, trigger))),
				);
			});
		},
		/** Fire-and-forget from the recording start path; never awaited there. */
		noteDictationStarting(): void {
			const o = current;
			if (o !== null) run(o, () => check(o, 'nextDictation'));
		},
		cancel: close,
		get isObserving(): boolean {
			return current !== null;
		},
	};
}

export type CorrectionObserver = ReturnType<typeof createCorrectionObserver>;
