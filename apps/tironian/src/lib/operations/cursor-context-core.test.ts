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

const ACCENTED: CursorContextOutcome = {
	kind: 'context',
	before: 'Zorv blenta, wuxo perché la quenta è già prulla da jarmex ',
	selection: '',
	after: ' Grin, Blorp',
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
	const { host, readContextAtCapture } = hostAnswering(async () => ACCENTED);
	expect(await captureCursorContext(host, false)).toBeNull();
	expect(readContextAtCapture).not.toHaveBeenCalled();
});

test('off Windows the host is never asked, even with the switch on', async () => {
	const { host, readContextAtCapture } = hostAnswering(
		async () => ACCENTED,
		false,
	);
	expect(await captureCursorContext(host, true)).toBeNull();
	expect(readContextAtCapture).not.toHaveBeenCalled();
});

test('with the switch on the host is asked once and the three slices are kept', async () => {
	const { host, readContextAtCapture } = hostAnswering(async () => ACCENTED);
	expect(await captureCursorContext(host, true)).toEqual({
		before: 'Zorv blenta, wuxo perché la quenta è già prulla da jarmex ',
		selection: '',
		after: ' Grin, Blorp',
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

// Invented words throughout: no fixture reads like anyone's real message.
const ENGLISH_FIELD = {
	before:
		'Notes on the quandrel plan: we will send the wexlow glim plan to Quandrel tomorrow morning. ',
	selection: '',
	after: '',
};

function fieldOf(before: string, selection = '', after = '') {
	return { before, selection, after };
}

test('Polish that adds eight words of the field the speaker never said is an echo', () => {
	expect(
		echoesCursorContext(
			'We will send the wexlow glim plan to Quandrel tomorrow morning. And the budget is approved.',
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

test('an echo that reuses a few of the speaker words is still an echo', () => {
	// Four of the eight words are the speaker's: under the five that clear it.
	expect(
		echoesCursorContext(
			'We will send the wexlow glim plan to Quandrel tomorrow morning.',
			'we will send the budget',
			ENGLISH_FIELD,
		),
	).toBe(true);
});

test('words the speaker said are not an echo', () => {
	expect(
		echoesCursorContext(
			'We will send the wexlow glim plan to Quandrel tomorrow morning, as promised.',
			'we will send the wexlow glim plan to quandrel tomorrow morning as promised',
			ENGLISH_FIELD,
		),
	).toBe(false);
});

test('fixing the spelling of a name the field holds is not an echo', () => {
	// The recognizer heard "Kwandrel"; Polish spelled it as the field does.
	expect(
		echoesCursorContext(
			'We will send the wexlow glim plan to Quandrel tomorrow morning.',
			'we will send the wexlow glim plan to kwandrel tomorrow morning',
			ENGLISH_FIELD,
		),
	).toBe(false);
	expect(
		echoesCursorContext(
			'Please forward the mivvel report to Ziovane before the call today.',
			'please forward the mivvel report to zhivon before the call today',
			fieldOf(
				'Please forward the mivvel report to Ziovane before the call today. ',
			),
		),
	).toBe(false);
});

test('removing fillers from what the speaker said is not an echo', () => {
	expect(
		echoesCursorContext(
			'We will send the wexlow glim plan to Quandrel tomorrow morning.',
			'um we will uh send the wexlow glim plan like to quandrel tomorrow morning you know',
			ENGLISH_FIELD,
		),
	).toBe(false);
});

test('re-dictating a selection with a self-correction is not an echo', () => {
	const field = fieldOf(
		'Prima: ',
		'la quenta di prulla è pronta per mercoledì',
		' Fine.',
	);
	expect(
		echoesCursorContext(
			'La quenta di prulla è pronta per mercoledì.',
			'la quenta di prulla è pronta per giovedì anzi no per mercoledì',
			field,
		),
	).toBe(false);
});

test('turning a spoken number into digits is not an echo', () => {
	expect(
		echoesCursorContext(
			'We need 3 wexlow glim units for the Vorplex build.',
			'we need three wexlow glim units for the vorplex build',
			fieldOf('We need 3 wexlow glim units for the Vorplex build. '),
		),
	).toBe(false);
});

test('case, accents and punctuation do not hide an echo', () => {
	const field = fieldOf(
		'Zorv blenta, wuxo perché la quenta è già prulla da jarmex. ',
	);
	expect(
		echoesCursorContext(
			'ZORV BLENTA wuxo perche la quenta e gia prulla da jarmex. Porto io i prulli.',
			'porto io i prulli',
			field,
		),
	).toBe(true);
});

test('a script without spaces compares runs of 16 characters', () => {
	const field = fieldOf('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏');
	expect(
		echoesCursorContext(
			'天地玄黄宇宙洪荒日月盈昃辰宿列张。好的。',
			'好的',
			field,
		),
	).toBe(true);
	// The speaker said it with one character different: Polish fixed it.
	expect(
		echoesCursorContext(
			'天地玄黄宇宙洪荒日月盈昃辰宿列张。',
			'天地玄黄宇宙洪流日月盈昃辰宿列张',
			field,
		),
	).toBe(false);
	expect(echoesCursorContext('好的。', '好的', field)).toBe(false);
});

test('an error that quotes four words of the field is caught', () => {
	expect(
		quotesCursorContext(
			'Bad request: "the wexlow glim plan" is not valid',
			ENGLISH_FIELD,
		),
	).toBe(true);
	expect(
		quotesCursorContext(
			'Bad request: "the wexlow glim" is not valid',
			ENGLISH_FIELD,
		),
	).toBe(false);
	expect(quotesCursorContext('Rate limited', ENGLISH_FIELD)).toBe(false);
	expect(quotesCursorContext('Rate limited', null)).toBe(false);
});

test('an error that quotes twenty characters of the field is caught', () => {
	const field = fieldOf('Token: xylophonorvelquandrelblorp ');
	expect(quotesCursorContext('invalid value xylophonorvelquandr', field)).toBe(
		true,
	);
	expect(quotesCursorContext('invalid value xylophonorv', field)).toBe(false);
});

test('a JSON-escaped multi-line body is caught', () => {
	const field = fieldOf('Zorv blenta,\nwuxo perché la quenta\nè già prulla. ');
	const body =
		'{"error":{"message":"Invalid prompt: \\"Zorv blenta,\\\\nwuxo perch\\u00e9 la quenta\\\\n\\u00e8 gi\\u00e0 prulla.\\"","type":"invalid_request"}}';
	expect(quotesCursorContext(body, field)).toBe(true);
});

test('escaped accents are decoded before matching', () => {
	const field = fieldOf('perché è già così ');
	expect(
		quotesCursorContext(
			'{"detail":"perch\\u00e9 \\u00e8 gi\\u00e0 cos\\u00ec"}',
			field,
		),
	).toBe(true);
});

test('an error that quotes a script without spaces is caught', () => {
	const field = fieldOf('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏');
	expect(
		quotesCursorContext('error near 天地玄黄宇宙洪荒日月盈昃辰宿列张寒来 here', field),
	).toBe(true);
	expect(quotesCursorContext('error near 天地玄黄宇宙洪荒', field)).toBe(false);
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
