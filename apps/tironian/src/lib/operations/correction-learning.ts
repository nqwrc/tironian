/**
 * The one production correction observer and its live dependencies. Its own
 * module, like `hands-free-instance.ts`, so the pure observer stays free of
 * app, platform, and report imports.
 */

import { os } from '#platform/os';
import { osNotify } from '#platform/os-notify';
import { goto } from '$app/navigation';
import type { TironianApp } from '$lib/app/app';
import { dictationPath } from '$lib/constants/urls';
import type { DeliveryOutcome } from '$lib/operations/delivery';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { m } from '../paraglide/messages';
import { endFieldObservation, readPastedField } from './field-read';
import {
	type CorrectionObserver,
	createCorrectionObserver,
	shouldObserve,
} from './learn-corrections/observer';
import type { Decision } from './learn-corrections/rules';
import { hashFold } from './learn-corrections/term-hash';

let observer: CorrectionObserver | null = null;
let boundTo: TironianApp | null = null;

function enabled(app: TironianApp): boolean {
	return os.isWindows && app.settings.get('learnFromCorrectionsEnabled');
}

/**
 * Fixed copy, never the term: `report` logs the whole notice
 * (`report/index.ts:99-104`), and an OS notification persists in the
 * notification centre and on the lock screen. The Dictation page shows the term.
 */
function announce(decision: Decision): void {
	const activated = decision.promote.length > 0;
	const title = activated
		? m.learned_term_active_title()
		: m.learned_term_pending_title();
	const description = activated
		? m.learned_term_active_description()
		: m.learned_term_pending_description();
	report.info({
		title,
		description,
		action: {
			label: m.learned_term_review(),
			onClick: () => goto(dictationPath('/dictation')),
		},
	});
	// A term now reaches providers; say so even when Tironian is in the background.
	if (activated && typeof document !== 'undefined' && !document.hasFocus()) {
		osNotify(title, description);
	}
}

function observerFor(app: TironianApp): CorrectionObserver {
	if (observer === null || boundTo !== app) {
		observer?.cancel();
		boundTo = app;
		observer = createCorrectionObserver({
			read: () => readPastedField(services.context),
			end: () => endFieldObservation(services.context),
			schedule: (ms, run) => {
				const timer = setTimeout(run, ms);
				return () => clearTimeout(timer);
			},
			enabled: () => enabled(app),
			hash: hashFold,
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

export const correctionLearning = {
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
		const clean =
			observed &&
			outcome.sinkKind === 'cursor' &&
			outcome.reach === 'output' &&
			!outcome.pressedEnter &&
			!outcome.withheld;
		if (!clean) {
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
