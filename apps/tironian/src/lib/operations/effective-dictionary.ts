/**
 * The glossary every prompt receives: the person's Dictionary verbatim and
 * first, then active learned terms not already present (ADR-0270). Pending
 * terms never appear. Manual first, so a recognizer budget overflow drops
 * learned terms before typed ones.
 */
import type { TironianApp } from '$lib/app/app';
import { foldTerm } from './learn-corrections/words';

export function composeGlossary(
	manual: readonly string[] | null,
	learned: readonly string[],
): string[] | null {
	const out = [...(manual ?? [])];
	const seen = new Set(out.map(foldTerm));
	for (const term of learned) {
		const fold = foldTerm(term);
		if (fold === '' || seen.has(fold)) continue;
		seen.add(fold);
		out.push(term);
	}
	return out.length === 0 ? null : out;
}

export function effectiveDictionary(app: TironianApp): string[] | null {
	return composeGlossary(
		app.settings.get('dictionary'),
		app.learnedTerms.activeTerms,
	);
}
