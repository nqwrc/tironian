import { expect, test } from 'bun:test';
import {
	decideLearning,
	extractCandidates,
	type HashedCandidate,
	type KnownTerms,
	similarity,
} from './rules';

const inside = { atFieldStart: false };
const terms = (delivered: string, region: string, edges = inside) => {
	const x = extractCandidates(delivered, region, edges);
	return x.kind === 'candidates' ? x.candidates.map((c) => c.term) : x.kind;
};

test('similarity is 1 - levenshtein / longer, on folds without spaces', () => {
	expect(similarity('cubernetes', 'Kubernetes')).toBeCloseTo(0.9);
	expect(similarity('gira', 'Jira')).toBeCloseTo(0.75);
	expect(similarity('git hub', 'GitHub')).toBe(1);
	expect(similarity('Daniels', 'Daniel e')).toBeCloseTo(0.857, 3);
	expect(similarity('cat', 'dog')).toBe(0);
});

// English
test('EN: a respelled product name is a candidate', () => {
	expect(
		terms('Deploy it on cubernetes tonight', 'Deploy it on Kubernetes tonight'),
	).toEqual(['Kubernetes']);
});
test('EN: two words joined into one name', () => {
	expect(
		terms(
			'I pushed the fix to git hub today',
			'I pushed the fix to GitHub today',
		),
	).toEqual(['GitHub']);
});
test('EN: a change of word is not a correction', () => {
	expect(terms('The cat sat down', 'The dog sat down')).toEqual([]);
});
test('EN: case-only and punctuation-only edits are ignored', () => {
	expect(terms('send it to tom', 'Send it to Tom.')).toEqual([]);
});
test('EN: a deletion is ignored', () => {
	expect(terms('please remove this word', 'please remove word')).toEqual([]);
});
test('EN: a replaced paste is gone', () => {
	expect(
		terms(
			'we should meet on monday to discuss the plan',
			'lets talk tomorrow about it instead',
		),
	).toBe('gone');
});
test('EN: an emptied field is gone', () => {
	expect(terms('we should meet on monday', '  ')).toBe('gone');
});
test('EN: any digit refuses the term', () => {
	expect(
		terms('the guest code is door seven', 'the guest code is door 7'),
	).toEqual([]);
	expect(
		terms('the code is ab12cd today', 'the code is AB12CD9X today'),
	).toEqual([]);
});
test('EN: an address refuses the term', () => {
	expect(
		terms(
			'please write to nico at mail today about the plan',
			'please write to nico@mail.it today about the plan',
		),
	).toEqual([]);
});
test('EN: a word typed on after the paste is not part of the fix', () => {
	expect(
		terms('I will call Jon tomorrow', 'I will call John tomorrow and'),
	).toEqual(['John']);
});
test('EN: typing on after a fix at the end of the paste is trimmed off, wherever the paste is', () => {
	// At the field end, or above an email signature (the after anchor): the
	// caret sits at the end of the paste either way, so the region ends there.
	expect(
		terms('Please ping cubernetes', 'Please ping Kubernetes team'),
	).toEqual(['Kubernetes']);
});
test('EN: a word typed inside the paste right after a fix stays in the term (accepted residue, pending only)', () => {
	expect(
		terms('Please ping cubernetes now', 'Please ping Kubernetes team now'),
	).toEqual(['Kubernetes team']);
});

// Italian
test('IT: a misheard tool name', () => {
	expect(
		terms('Ho aggiornato il ticket su gira', 'Ho aggiornato il ticket su Jira'),
	).toEqual(['Jira']);
});
test('IT: a first name fixed inside a full name', () => {
	expect(
		terms(
			'Ho parlato con Daniels Rossi ieri',
			'Ho parlato con Daniel Rossi ieri',
		),
	).toEqual(['Daniel']);
});
test('IT: a fix followed by a new word at the field end learns the fix only', () => {
	expect(
		terms('Ci vediamo domani con Daniels.', 'Ci vediamo domani con Daniel e'),
	).toEqual(['Daniel']);
});
test('IT: a fix followed by a new sentence crosses a sentence end and is refused', () => {
	expect(
		terms('Ci vediamo domani con Daniels.', 'Ci vediamo domani con Daniel. Ok'),
	).toEqual([]);
});
test('IT: a short secret with digits is never learned', () => {
	expect(
		terms(
			'la chiave della rete ospiti è fido 42',
			'la chiave della rete ospiti è Fido42',
		),
	).toEqual([]);
});
test('IT: an accent-only fix is ignored', () => {
	expect(terms('Non so perche', 'Non so perché')).toEqual([]);
});
test('IT: a common word is never learned', () => {
	expect(terms('Lo metto qui adesso', 'Lo metto qua adesso')).toEqual([]);
});
test('IT: a deletion is ignored', () => {
	expect(terms('allora quindi andiamo', 'quindi andiamo')).toEqual([]);
});
test('IT: more than three changed spots is a rewrite', () => {
	expect(
		terms(
			'uno due tre quattro cinque sei sette otto',
			'uni due tri quattro cinqua sei setta otto',
		),
	).toBe('rewrite');
});
test('IT: a new message in the same chat box is gone, not a correction', () => {
	expect(
		terms('Ciao Marco, a domani', 'Ciao Mario, ci vediamo stasera alle otto', {
			atFieldStart: true,
		}),
	).toBe('gone');
});

// The decision
const known = (over: Partial<KnownTerms> = {}): KnownTerms => ({
	inUse: () => false,
	pendingId: () => null,
	forgotten: () => false,
	rowCount: 0,
	...over,
});
const cand = (term: string, fromFold = 'x'): HashedCandidate => ({
	term,
	fold: term.toLowerCase(),
	fromFold,
	hash: `h:${term.toLowerCase()}`,
});

test('a new term is created pending', () => {
	expect(decideLearning([cand('Kubernetes')], known())).toEqual({
		create: ['Kubernetes'],
		promote: [],
	});
});
test('a term already pending is promoted, not created again', () => {
	const k = known({
		pendingId: (fold) => (fold === 'kubernetes' ? 'row-1' : null),
	});
	expect(decideLearning([cand('Kubernetes')], k)).toEqual({
		create: [],
		promote: ['row-1'],
	});
});
test('the same term twice in one observation counts once', () => {
	expect(decideLearning([cand('Jira'), cand('Jira')], known())).toEqual({
		create: ['Jira'],
		promote: [],
	});
});
test('a term in use, forgotten, or corrected away from a known term is not learned', () => {
	expect(
		decideLearning([cand('Jira')], known({ inUse: (f) => f === 'jira' })),
	).toEqual({ create: [], promote: [] });
	expect(
		decideLearning([cand('Jira')], known({ forgotten: (h) => h === 'h:jira' })),
	).toEqual({ create: [], promote: [] });
	expect(
		decideLearning(
			[cand('Jera', 'jira')],
			known({ inUse: (f) => f === 'jira' }),
		),
	).toEqual({ create: [], promote: [] });
	expect(
		decideLearning(
			[cand('Mario', 'marco')],
			known({ pendingId: (f) => (f === 'marco' ? 'row-2' : null) }),
		),
	).toEqual({ create: [], promote: [] });
});
test('more than two qualifying terms in one observation learns none', () => {
	expect(
		decideLearning([cand('Alfa'), cand('Bravo'), cand('Charlie')], known()),
	).toEqual({ create: [], promote: [] });
});
test('at the row cap learning is paused: nothing is created or promoted', () => {
	const k = known({
		rowCount: 100,
		pendingId: (f) => (f === 'jira' ? 'row-3' : null),
	});
	expect(decideLearning([cand('Kubernetes'), cand('Jira')], k)).toEqual({
		create: [],
		promote: [],
	});
});
test('just under the row cap a term is still created', () => {
	expect(decideLearning([cand('Kubernetes')], known({ rowCount: 99 }))).toEqual(
		{ create: ['Kubernetes'], promote: [] },
	);
});
