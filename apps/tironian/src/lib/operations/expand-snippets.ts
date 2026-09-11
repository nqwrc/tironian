/**
 * Snippet expansion: a pure, total substitution over the delivered text.
 *
 * Deterministic by construction, because a snippet body is a contract. An
 * address with one street name reworded is worse than no expansion at all, so
 * the model never sees this. That is the whole reason this is a function and
 * not a prompt block the way Dictionary is (ADR-0099).
 *
 * Runs after Polish, so a trigger arrives capitalized and punctuated. Word
 * boundaries are therefore any non-word character rather than whitespace: a
 * rule requiring no adjacent punctuation would never match at the end of a
 * sentence. See `specs/20260829T000000-snippets.md`.
 */

/** Letters, digits and underscore. Anything else ends a word. */
const WORD = /[\p{L}\p{N}_]/u;

/** Absent (past either end of the text) counts as a boundary. */
function isBoundary(char: string | undefined): boolean {
	return char === undefined || !WORD.test(char);
}

export type SnippetRule = {
	id: string;
	trigger: string;
	replacement: string;
};

/**
 * Replace every whole-word trigger occurrence with its saved text.
 *
 * One left-to-right pass whose output is never rescanned, so a replacement
 * containing another trigger stays literal and an `a -> b`, `b -> a` pair
 * terminates instead of looping. Longest trigger wins, ties broken by row id
 * so two devices agree.
 */
export function expandSnippets(
	text: string,
	snippets: readonly SnippetRule[],
): string {
	const rules = snippets
		.filter((snippet) => snippet.trigger.trim() !== '')
		.map((snippet) => ({ ...snippet, needle: snippet.trigger.toLowerCase() }))
		.toSorted(
			(left, right) =>
				right.trigger.length - left.trigger.length ||
				left.id.localeCompare(right.id),
		);
	if (rules.length === 0) return text;

	let out = '';
	let index = 0;
	while (index < text.length) {
		// Slice out of the original text rather than a prebuilt lowercase copy:
		// a case fold can change length, and that would desync every later index.
		const hit = rules.find(
			(rule) =>
				isBoundary(text[index - 1]) &&
				text.slice(index, index + rule.trigger.length).toLowerCase() ===
					rule.needle &&
				isBoundary(text[index + rule.trigger.length]),
		);
		if (hit === undefined) {
			out += text[index];
			index += 1;
			continue;
		}
		out += hit.replacement;
		index += hit.trigger.length;
	}
	return out;
}
