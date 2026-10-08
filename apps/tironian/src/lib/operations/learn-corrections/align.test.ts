import { expect, test } from 'bun:test';
import { alignWords } from './align';
import { tokenizeWords } from './words';

const hunks = (a: string, b: string) =>
	alignWords(tokenizeWords(a), tokenizeWords(b))?.map((h) => ({
		from: h.from.map((w) => w.surface).join(' '),
		to: h.to.map((w) => w.surface).join(' '),
	}));

test('one replaced word (EN)', () => {
	expect(
		hunks('Deploy it on cubernetes tonight', 'Deploy it on Kubernetes tonight'),
	).toEqual([{ from: 'cubernetes', to: 'Kubernetes' }]);
});

test('two words joined into one (EN)', () => {
	expect(
		hunks(
			'I pushed the fix to git hub today',
			'I pushed the fix to GitHub today',
		),
	).toEqual([{ from: 'git hub', to: 'GitHub' }]);
});

test('one replaced word (IT)', () => {
	expect(
		hunks('Ho aggiornato il ticket su gira', 'Ho aggiornato il ticket su Jira'),
	).toEqual([{ from: 'gira', to: 'Jira' }]);
});

test('typing on after a paste at the end joins the last hunk (IT)', () => {
	expect(
		hunks('Ci vediamo domani con Daniels.', 'Ci vediamo domani con Daniel. Ok'),
	).toEqual([{ from: 'Daniels', to: 'Daniel Ok' }]);
});

test('case, accent and punctuation changes produce no hunk (IT)', () => {
	expect(hunks('non so perche', 'Non so perché.')).toEqual([]);
});

test('a deletion is a hunk with an empty side (IT)', () => {
	expect(hunks('allora quindi andiamo', 'quindi andiamo')).toEqual([
		{ from: 'allora', to: '' },
	]);
});

test('over 400 words refuses', () => {
	const long = Array.from({ length: 401 }, (_, i) => `w${i}`).join(' ');
	expect(alignWords(tokenizeWords(long), tokenizeWords('x'))).toBeNull();
});
