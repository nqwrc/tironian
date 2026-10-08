/**
 * What counts as a correction worth learning. Every constant is ours and its
 * reason sits next to it; the deciding asymmetry is that a missed lesson
 * costs nothing and a wrong term biases every later transcription.
 */
import { alignWords, type Hunk } from './align';
import { COMMON_WORDS } from './common-words';
import { foldTerm, tokenizeWords, type Word } from './words';

export const LIMITS = {
	/** Fewer delivered words leaves nothing to align a correction against. */
	minDeliveredWords: 3,
	/** Fewer delivered words than this share still in place: the paste is gone. */
	minMatchedShare: 0.5,
	/** More touched spots than this is editing prose, not correcting words. */
	maxHunks: 3,
	/** A respelling spans at most a short name. */
	maxSideWords: 3,
	minTermUnits: 2,
	maxTermUnits: 40,
	/** A misrecognition is spelled close to the right word. */
	minSimilarity: 0.5,
	/** More qualifying terms than this in one edit is not a correction. */
	maxTermsPerObservation: 2,
	/** Pending plus active rows. Past this the recognizer budget drops terms anyway. */
	maxLearnedRows: 100,
} as const;

export type Candidate = { term: string; fold: string; fromFold: string };
export type HashedCandidate = Candidate & { hash: string };
/** Whether the region starts at the start of the field (an empty before anchor). */
export type Edges = { atFieldStart: boolean };
export type Extraction =
	| { kind: 'candidates'; candidates: Candidate[] }
	| { kind: 'gone' }
	| { kind: 'rewrite' }
	| { kind: 'unaligned' };
export type KnownTerms = {
	/** In the manual Dictionary, or an active learned term. */
	inUse(fold: string): boolean;
	/** The row id of a pending learned term with this fold, or null. */
	pendingId(fold: string): string | null;
	/** Whether this SHA-256 of a fold was forgotten. */
	forgotten(hash: string): boolean;
	/** Pending plus active rows. */
	rowCount: number;
};
export type Decision = { create: string[]; promote: string[] };

function levenshtein(a: string[], b: string[]): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				previous[j]! + 1,
				current[j - 1]! + 1,
				previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[b.length]!;
}

export function similarity(a: string, b: string): number {
	const x = [...foldTerm(a).replace(/\s/gu, '')];
	const y = [...foldTerm(b).replace(/\s/gu, '')];
	const longest = Math.max(x.length, y.length);
	return longest === 0 ? 1 : 1 - levenshtein(x, y) / longest;
}

const surfaces = (words: readonly Word[]) =>
	words.map((w) => w.surface).join(' ');

/** Digits are codes, PINs and numbers; the rest is contact data. Never a prompt term. */
function looksSensitive(term: string): boolean {
	return /\p{Nd}/u.test(term) || /@|:\/\/|\bwww\./iu.test(term);
}

/** A sentence end on any word but the last: a fix plus new typing. */
function crossesSentenceEnd(words: readonly Word[]): boolean {
	return words.slice(0, -1).some((w) => w.endsSentence);
}

/**
 * What the person typed past the paste joins the hunk next to it. The caret
 * sits at the end of the paste, so a hunk that reaches the end of the region
 * is trimmed wherever the paste is: at the field end, or above a signature.
 * At the field start (an empty before anchor) text typed before the paste
 * joins the first hunk the same way. Keep the prefix (region end) or suffix
 * (field start) of the typed side most similar to the delivered side; the
 * shorter one on a tie.
 */
function trimAtEdge(h: Hunk, regionWords: number, edges: Edges): Word[] {
	const atEnd = h.toStart + h.to.length === regionWords;
	const atStart = edges.atFieldStart && h.toStart === 0;
	if (!atEnd && !atStart) return h.to;
	const from = surfaces(h.from);
	let best = h.to;
	let bestScore = -1;
	for (let size = 1; size <= h.to.length; size++) {
		const part = atEnd ? h.to.slice(0, size) : h.to.slice(h.to.length - size);
		const score = similarity(from, surfaces(part));
		if (score > bestScore) {
			best = part;
			bestScore = score;
		}
	}
	return best;
}

export function extractCandidates(
	delivered: string,
	region: string,
	edges: Edges,
): Extraction {
	const a = tokenizeWords(delivered);
	const b = tokenizeWords(region);
	if (b.length === 0) return { kind: 'gone' };
	const hunks = alignWords(a, b);
	if (hunks === null) return { kind: 'unaligned' };
	const touching = hunks.filter((h) => h.from.length > 0);
	const changed = touching.reduce((sum, h) => sum + h.from.length, 0);
	if (a.length - changed < a.length * LIMITS.minMatchedShare)
		return { kind: 'gone' };
	if (touching.length > LIMITS.maxHunks) return { kind: 'rewrite' };
	const candidates: Candidate[] = [];
	for (const h of touching) {
		if (h.to.length === 0) continue;
		if (crossesSentenceEnd(h.from) || crossesSentenceEnd(h.to)) continue;
		const to = trimAtEdge(h, b.length, edges);
		if (h.from.length > LIMITS.maxSideWords || to.length > LIMITS.maxSideWords)
			continue;
		const term = surfaces(to);
		const from = surfaces(h.from);
		if (term.length < LIMITS.minTermUnits || term.length > LIMITS.maxTermUnits)
			continue;
		if (similarity(from, term) < LIMITS.minSimilarity) continue;
		if (looksSensitive(term)) continue;
		if (to.every((w) => COMMON_WORDS.has(w.fold))) continue;
		candidates.push({ term, fold: foldTerm(term), fromFold: foldTerm(from) });
	}
	return { kind: 'candidates', candidates };
}

/**
 * Each observation decides once and then closes, so a pending row that
 * matches was created by an earlier, different dictation: that second
 * sighting is what promotes it.
 */
export function decideLearning(
	candidates: readonly HashedCandidate[],
	known: KnownTerms,
): Decision {
	const create: string[] = [];
	const promote: string[] = [];
	const seen = new Set<string>();
	for (const c of candidates) {
		if (seen.has(c.fold)) continue;
		seen.add(c.fold);
		if (known.forgotten(c.hash) || known.inUse(c.fold)) continue;
		// Correcting away from a known term is a change of mind, not a misrecognition.
		if (known.inUse(c.fromFold) || known.pendingId(c.fromFold) !== null)
			continue;
		const pending = known.pendingId(c.fold);
		if (pending !== null) promote.push(pending);
		else create.push(c.term);
	}
	if (create.length + promote.length > LIMITS.maxTermsPerObservation)
		return { create: [], promote: [] };
	if (known.rowCount + create.length > LIMITS.maxLearnedRows)
		return { create: [], promote };
	return { create, promote };
}
