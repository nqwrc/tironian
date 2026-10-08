/**
 * The learner's wiring: what counts as a clean paste, when it may observe at
 * all, and that one app keeps one observer. The host is an argument, so no
 * module is mocked and the result does not depend on test file order.
 */
import { expect, mock, test } from 'bun:test';
import type { TironianApp } from '$lib/app/app';
import {
	createCorrectionLearning,
	isCleanPaste,
} from './correction-learning-core';
import type { DeliveryOutcome } from './delivery-reach';
import type { FieldContext } from './field-read';

const delivered = 'Deploy it on cubernetes tonight';
const fixed = 'Deploy it on Kubernetes tonight';

const clean: DeliveryOutcome = {
	reach: 'output',
	sinkKind: 'cursor',
	pressedEnter: false,
	withheld: false,
	deliveredToAppId: null,
};

test('only an observed, unwithheld cursor paste with no Enter is clean', () => {
	expect(isCleanPaste(true, clean)).toBe(true);
	expect(isCleanPaste(false, clean)).toBe(false);
	expect(isCleanPaste(true, { ...clean, sinkKind: 'clipboard' })).toBe(false);
	expect(isCleanPaste(true, { ...clean, sinkKind: 'ledger' })).toBe(false);
	expect(isCleanPaste(true, { ...clean, reach: 'clipboard' })).toBe(false);
	expect(isCleanPaste(true, { ...clean, pressedEnter: true })).toBe(false);
	expect(isCleanPaste(true, { ...clean, withheld: true })).toBe(false);
});

function fakeApp(over: { enabled?: boolean } = {}) {
	const created: string[] = [];
	const activated: string[] = [];
	const app = {
		settings: {
			get: (key: string) =>
				key === 'learnFromCorrectionsEnabled' ? (over.enabled ?? true) : [],
		},
		learnedTerms: {
			known: () => ({
				inUse: () => false,
				pendingId: (fold: string) => (fold === 'jira' ? 'row-1' : null),
				forgotten: () => false,
				rowCount: 0,
			}),
			create: (term: string) => created.push(term),
			activate: (id: string) => activated.push(id),
		},
	} as unknown as TironianApp;
	return { app, created, activated };
}

function harness(
	spans: { region: string; generation?: number }[],
	over: { windows?: boolean } = {},
) {
	let now = 0;
	const timers: { at: number; run: () => void; live: boolean }[] = [];
	let reads = 0;
	const end = mock(async (_generation: number) => {});
	const context: FieldContext = {
		readFocusedText: async () => {
			const span = spans[Math.min(reads++, spans.length - 1)];
			return {
				kind: 'span',
				generation: span?.generation ?? 1,
				before: 'Note: ',
				region: span?.region ?? '',
				after: ' End.',
			};
		},
		endFieldObservation: end,
	};
	const announceSuggested = mock(() => {});
	const announceActivated = mock(() => {});
	const learning = createCorrectionLearning({
		windows: over.windows ?? true,
		context,
		schedule: (ms, run) => {
			const timer = { at: now + ms, run, live: true };
			timers.push(timer);
			return () => {
				timer.live = false;
			};
		},
		hash: async (fold) => `h:${fold}`,
		announceSuggested,
		announceActivated,
	});
	async function advance(ms: number) {
		const until = now + ms;
		for (;;) {
			const next = timers
				.filter((t) => t.live && t.at <= until)
				.sort((a, b) => a.at - b.at)[0];
			if (!next) break;
			now = next.at;
			next.live = false;
			next.run();
			await new Promise((r) => setTimeout(r, 0));
		}
		now = until;
		await new Promise((r) => setTimeout(r, 0));
	}
	return {
		learning,
		advance,
		end,
		reads: () => reads,
		live: () => timers.filter((t) => t.live).length,
		announceSuggested,
		announceActivated,
	};
}

const open = { deliveredText: delivered, observed: true, outcome: clean };

test('it observes only on Windows, with the setting on, and for a delivery worth watching', () => {
	const on = fakeApp();
	expect(harness([]).learning.wantsToObserve(on.app, delivered)).toBe(true);
	expect(harness([]).learning.wantsToObserve(on.app, 'Ciao Marco')).toBe(false);
	expect(harness([]).learning.wantsToObserve(on.app, 'word '.repeat(900))).toBe(
		false,
	);
	const off = fakeApp({ enabled: false });
	expect(harness([]).learning.wantsToObserve(off.app, delivered)).toBe(false);
	expect(
		harness([], { windows: false }).learning.wantsToObserve(on.app, delivered),
	).toBe(false);
});

test('a clean paste opens an observation and an unclean one does not', async () => {
	const h = harness([{ region: delivered }]);
	const { app } = fakeApp();
	h.learning.afterDelivery(app, {
		...open,
		outcome: { ...clean, pressedEnter: true },
	});
	expect(h.live()).toBe(0);
	h.learning.afterDelivery(app, { ...open, observed: false });
	expect(h.live()).toBe(0);
	h.learning.afterDelivery(app, open);
	expect(h.live()).toBe(4);
	await h.advance(1000);
	expect(h.reads()).toBe(1);
});

test('an unclean delivery ends an observation already open', async () => {
	const h = harness([{ region: delivered, generation: 3 }]);
	const { app } = fakeApp();
	h.learning.afterDelivery(app, open);
	await h.advance(1000);
	h.learning.afterDelivery(app, {
		...open,
		outcome: { ...clean, withheld: true },
	});
	expect(h.live()).toBe(0);
	expect(h.end).toHaveBeenCalledWith(3);
});

test('one app keeps one observer, and another app replaces it', async () => {
	const h = harness([{ region: delivered, generation: 5 }]);
	const first = fakeApp();
	h.learning.afterDelivery(first.app, open);
	await h.advance(1000);
	// The same observer answers the next dictation's start.
	h.learning.dictationStarting(first.app);
	await h.advance(0);
	expect(h.reads()).toBe(2);
	expect(h.end).toHaveBeenCalledWith(5);

	h.learning.afterDelivery(first.app, open);
	const second = fakeApp();
	// A different app brings its own observer with nothing open to read.
	h.learning.dictationStarting(second.app);
	await h.advance(0);
	expect(h.reads()).toBe(2);
	expect(h.live()).toBe(0);
});

test('cancel closes the open observation', () => {
	const h = harness([{ region: delivered }]);
	const { app } = fakeApp();
	h.learning.afterDelivery(app, open);
	h.learning.cancel();
	expect(h.live()).toBe(0);
	h.learning.cancel();
});

async function learnFrom(
	h: ReturnType<typeof harness>,
	app: TironianApp,
	text: string,
) {
	h.learning.afterDelivery(app, { ...open, deliveredText: text });
	await h.advance(45_000);
}

test('a new term is stored pending and announced as suggested only', async () => {
	const h = harness([{ region: delivered }, { region: fixed }]);
	const fake = fakeApp();
	await learnFrom(h, fake.app, delivered);
	expect(fake.created).toEqual(['Kubernetes']);
	expect(fake.activated).toEqual([]);
	expect(h.announceSuggested).toHaveBeenCalledTimes(1);
	expect(h.announceActivated).not.toHaveBeenCalled();
});

test('a decision that suggests one term and activates another announces both', async () => {
	const d = 'Deploy cubernetes on gira tonight';
	const h = harness([
		{ region: d },
		{ region: 'Deploy Kubernetes on Jira tonight' },
	]);
	const fake = fakeApp();
	await learnFrom(h, fake.app, d);
	expect(fake.created).toEqual(['Kubernetes']);
	expect(fake.activated).toEqual(['row-1']);
	expect(h.announceSuggested).toHaveBeenCalledTimes(1);
	expect(h.announceActivated).toHaveBeenCalledTimes(1);
});

test('a pending term repeated alone is activated and announced as in use only', async () => {
	const d = 'Ho aggiornato il ticket su gira';
	const h = harness([
		{ region: d },
		{ region: 'Ho aggiornato il ticket su Jira' },
	]);
	const fake = fakeApp();
	await learnFrom(h, fake.app, d);
	expect(fake.created).toEqual([]);
	expect(fake.activated).toEqual(['row-1']);
	expect(h.announceSuggested).not.toHaveBeenCalled();
	expect(h.announceActivated).toHaveBeenCalledTimes(1);
});
