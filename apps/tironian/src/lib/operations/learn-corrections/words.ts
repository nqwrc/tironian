/** Words as the correction learner sees them: whitespace tokens, edge punctuation off, compared by fold. */
export type Word = { surface: string; fold: string; endsSentence: boolean };

const EDGE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const SENTENCE_END = /[.!?\u2026]["'\u00bb\u201d)]*$/u;

export function foldText(s: string): string {
	return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function foldTerm(s: string): string {
	return foldText(s).trim().replace(/\s+/gu, ' ');
}

export function tokenizeWords(text: string): Word[] {
	const words: Word[] = [];
	for (const raw of text.split(/\s+/u)) {
		const surface = raw.replace(EDGE, '');
		if (surface === '') continue;
		words.push({
			surface,
			fold: foldText(surface),
			endsSentence: SENTENCE_END.test(raw),
		});
	}
	return words;
}
