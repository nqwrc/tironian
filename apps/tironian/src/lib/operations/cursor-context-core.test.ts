/**
 * The webview half of the capture-start read (ADR-0272): when it may ask the
 * host at all, what it keeps, and the echo check Polish relies on. The host is
 * an argument, so no module is mocked.
 */
import { expect, mock, test } from 'bun:test';
import type { CursorContextOutcome } from '$lib/services/context/types';
import {
	CURSOR_CONTEXT_CAPS,
	type CursorContextHost,
	captureCursorContext,
	clampCursorContext,
	echoesCursorContext,
	holdCursorContext,
	quotesCursorContext,
} from './cursor-context-core';

const ITALIAN: CursorContextOutcome = {
	kind: 'context',
	before:
		"Ciao Giulia, ti confermo che la riunione con l'avvocato Pagnoncelli è ",
	selection: '',
	after: ' A presto, Marco',
};

function hostAnswering(
	read: () => Promise<CursorContextOutcome>,
	windows = true,
) {
	const readContextAtCapture = mock(read);
	const host: CursorContextHost = { windows, reader: { readContextAtCapture } };
	return { host, readContextAtCapture };
}

function hasLoneSurrogate(text: string): boolean {
	return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
		text,
	);
}

test('with the switch off the host is never asked', async () => {
	const { host, readContextAtCapture } = hostAnswering(async () => ITALIAN);
	expect(await captureCursorContext(host, false)).toBeNull();
	expect(readContextAtCapture).not.toHaveBeenCalled();
});

test('off Windows the host is never asked, even with the switch on', async () => {
	const { host, readContextAtCapture } = hostAnswering(
		async () => ITALIAN,
		false,
	);
	expect(await captureCursorContext(host, true)).toBeNull();
	expect(readContextAtCapture).not.toHaveBeenCalled();
});

test('with the switch on the host is asked once and the three slices are kept', async () => {
	const { host, readContextAtCapture } = hostAnswering(async () => ITALIAN);
	expect(await captureCursorContext(host, true)).toEqual({
		before:
			"Ciao Giulia, ti confermo che la riunione con l'avvocato Pagnoncelli è ",
		selection: '',
		after: ' A presto, Marco',
	});
	expect(readContextAtCapture).toHaveBeenCalledTimes(1);
});

test('a refusal, a rejection or a stall is no context', async () => {
	const refusal = hostAnswering(async () => ({
		kind: 'refused',
		reason: 'secure',
	}));
	expect(await captureCursorContext(refusal.host, true)).toBeNull();
	const rejection = hostAnswering(() => Promise.reject(new Error('COM')));
	expect(await captureCursorContext(rejection.host, true)).toBeNull();
	const stall = hostAnswering(
		() => new Promise<CursorContextOutcome>(() => {}),
	);
	expect(
		await captureCursorContext({ ...stall.host, timeoutMs: 5 }, true),
	).toBeNull();
});

test('a field holding only whitespace is no context', async () => {
	const { host } = hostAnswering(async () => ({
		kind: 'context',
		before: '  \n',
		selection: '',
		after: ' ',
	}));
	expect(await captureCursorContext(host, true)).toBeNull();
});

test('the webview clamps to the host caps again', () => {
	expect(CURSOR_CONTEXT_CAPS).toEqual({
		before: 400,
		selection: 200,
		after: 200,
	});
	const clamped = clampCursorContext({
		before: `${'a'.repeat(500)}END`,
		selection: `START${'b'.repeat(500)}`,
		after: `START${'c'.repeat(500)}`,
	});
	expect(clamped?.before).toHaveLength(400);
	expect(clamped?.before.endsWith('END')).toBe(true);
	expect(clamped?.selection).toHaveLength(200);
	expect(clamped?.selection.startsWith('START')).toBe(true);
	expect(clamped?.after).toHaveLength(200);
});

test('a clamp never splits an emoji', () => {
	const clamped = clampCursorContext({
		before: `${'😀'.repeat(300)}x`,
		selection: '',
		after: `x${'😀'.repeat(300)}`,
	});
	expect(hasLoneSurrogate(clamped?.before ?? '')).toBe(false);
	expect(hasLoneSurrogate(clamped?.after ?? '')).toBe(false);
});

const ENGLISH_FIELD = {
	before:
		'Thanks for the notes on the Kubernetes migration, I will send the rollout plan to Siobhan tomorrow. ',
	selection: '',
	after: '',
};

test('Polish that repeats eight words of the field echoes it', () => {
	expect(
		echoesCursorContext(
			'I will send the rollout plan to Siobhan tomorrow. And the budget is approved.',
			'and the budget is approved',
			ENGLISH_FIELD,
		),
	).toBe(true);
	expect(
		echoesCursorContext(
			'And the budget is approved.',
			'and the budget is approved',
			ENGLISH_FIELD,
		),
	).toBe(false);
});

test('words the speaker said are not an echo', () => {
	expect(
		echoesCursorContext(
			'I will send the rollout plan to Siobhan tomorrow, as promised.',
			'i will send the rollout plan to siobhan tomorrow as promised',
			ENGLISH_FIELD,
		),
	).toBe(false);
});

test('case and punctuation do not hide an Italian echo', () => {
	const field = {
		before:
			"Ciao Giulia, ti confermo che la riunione con l'avvocato Pagnoncelli è spostata a giovedì. ",
		selection: '',
		after: '',
	};
	expect(
		echoesCursorContext(
			"Ti confermo che la riunione con l'avvocato Pagnoncelli è spostata. Porto io i documenti.",
			'porto io i documenti',
			field,
		),
	).toBe(true);
});

test('a provider error that quotes eight words of the field is caught', () => {
	expect(
		quotesCursorContext(
			'Bad request: "send the rollout plan to Siobhan tomorrow, as promised."',
			{
				before:
					'I will send the rollout plan to Siobhan tomorrow, as promised. ',
				selection: '',
				after: '',
			},
		),
	).toBe(true);
	expect(quotesCursorContext('Rate limited', ENGLISH_FIELD)).toBe(false);
	expect(quotesCursorContext('Rate limited', null)).toBe(false);
});

test('the holder gives the slice back until it is cleared, then nothing', () => {
	const holder = holdCursorContext(ENGLISH_FIELD);
	expect(holder?.read()).toEqual(ENGLISH_FIELD);
	expect(holder?.read()).toEqual(ENGLISH_FIELD);
	holder?.clear();
	expect(holder?.read()).toBeNull();
	holder?.clear();
	expect(holder?.read()).toBeNull();
});

test('no slice, no holder', () => {
	expect(holdCursorContext(null)).toBeNull();
});
