/**
 * The correction learner's wiring over the pure observer: when to observe,
 * what counts as a clean paste, and one observer per app. Every platform and
 * UI dependency is an argument of `createCorrectionLearning`, so this module
 * has no runtime `$lib` import and its test mocks no module. The production
 * instance, with its notices and services, is `correction-learning.ts`.
 */
import type { TironianApp } from '$lib/app/app';
import type { DeliveryOutcome } from './delivery-reach';
import {
	endFieldObservation,
	type FieldContext,
	readPastedField,
} from './field-read';
import {
	type CorrectionObserver,
	createCorrectionObserver,
	shouldObserve,
} from './learn-corrections/observer';
import type { Decision } from './learn-corrections/rules';

export type CorrectionLearningHost = {
	/** Field reading is Windows only; the host refuses elsewhere too. */
	windows: boolean;
	context: FieldContext;
	schedule(ms: number, run: () => void): () => void;
	hash(fold: string): Promise<string>;
	/**
	 * The two notices carry fixed copy, never the term: `report` logs the whole
	 * notice (`report/index.ts:99-104`), and an OS notification persists in the
	 * notification centre and on the lock screen. The Dictation page shows the
	 * term. A decision can need both.
	 */
	announceSuggested(): void;
	announceActivated(): void;
};

/**
 * A live dictation that landed at the cursor, was observed by the host, and
 * neither pressed Enter nor was withheld. Anything else ends observing.
 */
export function isCleanPaste(
	observed: boolean,
	outcome: DeliveryOutcome,
): boolean {
	return (
		observed &&
		outcome.sinkKind === 'cursor' &&
		outcome.reach === 'output' &&
		!outcome.pressedEnter &&
		!outcome.withheld
	);
}

export function createCorrectionLearning(host: CorrectionLearningHost) {
	let observer: CorrectionObserver | null = null;
	let boundTo: TironianApp | null = null;

	function enabled(app: TironianApp): boolean {
		return host.windows && app.settings.get('learnFromCorrectionsEnabled');
	}

	function announce(decision: Decision): void {
		if (decision.create.length > 0) host.announceSuggested();
		if (decision.promote.length > 0) host.announceActivated();
	}

	function observerFor(app: TironianApp): CorrectionObserver {
		if (observer === null || boundTo !== app) {
			observer?.cancel();
			boundTo = app;
			observer = createCorrectionObserver({
				read: () => readPastedField(host.context),
				end: (generation) => endFieldObservation(host.context, generation),
				schedule: host.schedule,
				enabled: () => enabled(app),
				hash: host.hash,
				known: () => app.learnedTerms.known(app.settings.get('dictionary')),
				learn: (decision) => {
					for (const term of decision.create) app.learnedTerms.create(term);
					for (const id of decision.promote) app.learnedTerms.activate(id);
					announce(decision);
				},
			});
		}
		return observer;
	}

	return {
		/** Asked before delivery, because `write_text` records the target as it pastes. */
		wantsToObserve(app: TironianApp, deliveredText: string): boolean {
			return enabled(app) && shouldObserve(deliveredText);
		},
		/** After a live dictation's delivery. Anything but a clean, observed cursor paste ends observing. */
		afterDelivery(
			app: TironianApp,
			{
				deliveredText,
				observed,
				outcome,
			}: { deliveredText: string; observed: boolean; outcome: DeliveryOutcome },
		): void {
			if (!isCleanPaste(observed, outcome)) {
				observerFor(app).cancel();
				return;
			}
			observerFor(app).open({ delivered: deliveredText });
		},
		/** A new dictation is starting: take the next-dictation read now. Never awaited. */
		dictationStarting(app: TironianApp): void {
			observerFor(app).noteDictationStarting();
		},
		/** The pasted text was submitted, removed, or pasted over. */
		cancel(): void {
			observer?.cancel();
		},
	};
}
