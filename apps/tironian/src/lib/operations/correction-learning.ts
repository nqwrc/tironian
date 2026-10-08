/**
 * The one production correction learner and its live dependencies. Its own
 * module, like `hands-free-instance.ts`, so the learner's logic
 * (`correction-learning-core.ts`) and the pure observer stay free of app,
 * platform, and report imports.
 */

import { os } from '#platform/os';
import { osNotify } from '#platform/os-notify';
import { goto } from '$app/navigation';
import { dictationPath } from '$lib/constants/urls';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { m } from '../paraglide/messages';
import { createCorrectionLearning } from './correction-learning-core';
import { hashFold } from './learn-corrections/term-hash';

const reviewAction = () => ({
	label: m.learned_term_review(),
	onClick: () => goto(dictationPath('/dictation')),
});

export const correctionLearning = createCorrectionLearning({
	windows: os.isWindows,
	get context() {
		return services.context;
	},
	schedule: (ms, run) => {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
	hash: hashFold,
	announceSuggested() {
		report.info({
			title: m.learned_term_pending_title(),
			description: m.learned_term_pending_description(),
			action: reviewAction(),
		});
	},
	announceActivated() {
		const title = m.learned_term_active_title();
		const description = m.learned_term_active_description();
		report.info({
			title,
			description,
			action: reviewAction(),
		});
		// A term now reaches providers; say so even when Tironian is in the background.
		if (typeof document !== 'undefined' && !document.hasFocus()) {
			osNotify(title, description);
		}
	},
});
