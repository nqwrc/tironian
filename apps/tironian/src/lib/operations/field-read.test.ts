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
});
const end = mock(async () => {});
const context: FieldContext = {
	readFocusedText: () => respond(),
	endFieldObservation: end,
};

test('a span passes through', async () => {
	respond = async () => ({
		kind: 'span',
		before: 'Note: ',
		region: 'Deploy on Kubernetes',
		after: '',
	});
	expect(await readPastedField(context)).toEqual({
		kind: 'span',
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
		respond = async () => ({ kind: 'refused', reason });
		expect(await readPastedField(context)).toEqual({ kind: 'unavailable' });
	}
});

test('a rejected call is unavailable, never thrown', async () => {
	respond = () => Promise.reject(new Error('no capability'));
	expect(await readPastedField(context)).toEqual({ kind: 'unavailable' });
});

test('a stalled call is unavailable after the cap', async () => {
	respond = () => new Promise(() => {});
	const started = Date.now();
	expect(await readPastedField(context)).toEqual({ kind: 'unavailable' });
	expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
});

test('ending the observation never throws, even when the host call fails', async () => {
	end.mockImplementationOnce(() => Promise.reject(new Error('gone')));
	endFieldObservation(context);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(end).toHaveBeenCalledTimes(1);
});
