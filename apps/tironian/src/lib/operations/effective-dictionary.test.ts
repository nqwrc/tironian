import { expect, test } from 'bun:test';
import { composeGlossary } from './effective-dictionary';

test('nothing anywhere is null, as the prompt builders expect', () => {
	expect(composeGlossary(null, [])).toBeNull();
});
test('manual first and verbatim, learned after, folded duplicates dropped', () => {
	expect(
		composeGlossary(
			['Kubernetes', 'kubernetes'],
			['KUBERNETES', 'Jira', 'Nicolò', 'nicolo'],
		),
	).toEqual(['Kubernetes', 'kubernetes', 'Jira', 'Nicolò']);
});
test('learned alone still reaches the prompt', () => {
	expect(composeGlossary(null, ['GitHub'])).toEqual(['GitHub']);
});
