/**
 * The correction learner's bounded read. The context service is an argument,
 * so no module is mocked and the result does not depend on test file order or
 * on registry isolation.
 */
import { expect, mock, test } from 'bun:test';
import type { FieldReadOutcome, FieldRefusal } from '../tauri/bindings.gen';
import {
	endFieldObservation,
	type FieldContext,
	readPastedField,
} from './field-read';

let respond: () => Promise<FieldReadOutcome> = async () => ({
	kind: 'refused',
	reason: 'secure',
	generation: 1,
});
const end = mock(async () => {});
const context: FieldContext = {
	readFocusedText: () => respond(),
	endFieldObservation: end,
};

test('a span passes through', async () => {
	respond = async () => ({
		kind: 'span',
		generation: 4,
		before: 'Note: ',
		region: 'Deploy on Kubernetes',
		after: '',
	});
	expect(await readPastedField(context)).toEqual({
		kind: 'span',
		generation: 4,
		before: 'Note: ',
		region: 'Deploy on Kubernetes',
		after: '',
	});
});

test('every refusal is unavailable', async () => {
	const reasons: FieldRefusal[] = [
		'noTarget',
		'secure',
		'denied',
		'moved',
		'notFound',
		'tooLong',
		'unsupported',
	];
	for (const reason of reasons) {
		respond = async () => ({ kind: 'refused', reason, generation: 2 });
		expect(await readPastedField(context)).toEqual({
			kind: 'unavailable',
			generation: 2,
		});
	}
	respond = async () => ({
		kind: 'refused',
		reason: 'noTarget',
		generation: null,
	});
	expect(await readPastedField(context)).toEqual({
		kind: 'unavailable',
		generation: null,
	});
});

test('a rejected call is unavailable, never thrown', async () => {
	respond = () => Promise.reject(new Error('no capability'));
	expect(await readPastedField(context)).toEqual({
		kind: 'unavailable',
		generation: null,
	});
});

test('a stalled call is unavailable after the cap', async () => {
	respond = () => new Promise(() => {});
	const started = Date.now();
	expect(await readPastedField(context)).toEqual({
		kind: 'unavailable',
		generation: null,
	});
	expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
});

test('ending the observation never throws, even when the host call fails', async () => {
	end.mockImplementationOnce(() => Promise.reject(new Error('gone')));
	endFieldObservation(context, 5);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(end).toHaveBeenCalledTimes(1);
	expect(end).toHaveBeenCalledWith(5);
});

test('with no generation the host is not asked to clear anything', async () => {
	end.mockClear();
	endFieldObservation(context, null);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(end).not.toHaveBeenCalled();
});
