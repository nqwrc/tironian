import { expect, test } from 'bun:test';
import { expandSnippets, type SnippetRule } from './expand-snippets';

/**
 * The contract the pipeline edit must preserve.
 *
 * `processRecordingPipeline` needs a live workspace, recorder and provider, so
 * the seam itself is verified by hand. What these lock down is the property
 * that made "after Polish" the right placement: expansion behaves the same on
 * polished and unpolished text, so Polish being on or off cannot change whether
 * a snippet works.
 */

const ADDRESS: SnippetRule = {
	id: 's1',
	trigger: 'my address',
	replacement: '123 Main Street',
};

test('expansion survives the capitalization and full stop Polish adds', () => {
	// What Polish hands the delivery step when it ran.
	const polished = 'Send it to my address.';
	expect(expandSnippets(polished, [ADDRESS])).toBe(
		'Send it to 123 Main Street.',
	);
});

test('expansion behaves identically on an unpolished transcript', () => {
	// What the delivery step gets when Polish is off or failed to its fallback.
	const raw = 'send it to my address';
	expect(expandSnippets(raw, [ADDRESS])).toBe('send it to 123 Main Street');
});
