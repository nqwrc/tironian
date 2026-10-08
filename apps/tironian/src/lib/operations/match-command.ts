/**
 * Command Mode matching: a pure, total classification of one utterance.
 *
 * Whole-utterance equality, not substring search. A phrase inside a sentence is
 * content, because mid-stream matching has unbounded false positives with no
 * boundary rule that fixes them ("he said scratch that idea and moved on").
 *
 * Runs before Polish, which is the opposite of Snippets. Polish would reword
 * "scratch that" into prose, so a matcher downstream of it would only ever see
 * the phrase destroyed. Its failure mode is a phrase that does not match, which
 * delivers as ordinary text: visible and recoverable.
 *
 * One phrase also works as a suffix: "press enter" spoken as the last sentence
 * of a dictation sends the text and then Enter (`splitTrailingEnter`). In chat
 * and prompt boxes Enter is what sends, so this saves reaching for the keyboard
 * after a dictation the person already knows is finished.
 *
 * The suffix must be its own sentence. "Type your password and press enter."
 * ends in the phrase too, and a misfire there is the expensive kind: Enter
 * submits the cut-off text and the submit cannot be undone.
 */

export type VoiceCommandId = 'scratchThat' | 'stopListening' | 'pressEnter';

/**
 * The spoken phrases, already in normalized form. Fixed in code rather than
 * user data: snippets are the user's content, commands are app behavior.
 */
const PHRASES: Map<string, VoiceCommandId> = new Map([
	['scratch that', 'scratchThat'],
	['undo that', 'scratchThat'],
	['stop listening', 'stopListening'],
	['press enter', 'pressEnter'],
	['premi invio', 'pressEnter'],
]);

/**
 * The Enter phrases as a closing sentence: after a sentence end or a line
 * break, followed by nothing but a full stop, an exclamation mark or an
 * ellipsis. A question ("Press enter?") stays text, and so does the phrase
 * inside a clause, quotes or brackets. Bare "invio" is left out on purpose:
 * Italian "ti invio" ("I am sending you") ends ordinary sentences.
 */
const TRAILING_ENTER = /[.!?…\n]\s*(press\s+enter|premi\s+invio)[.!…\s]*$/iu;

/** Punctuation and symbols, stripped from the ends of an utterance only. */
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * Reduce an utterance to the form the table is written in.
 *
 * Order matters. Edge punctuation is stripped after trimming so " scratch
 * that. " reaches the table, and internal punctuation survives, so
 * "scratch, that" stays unmatched rather than silently becoming a command.
 */
function normalize(text: string): string {
	return text
		.trim()
		.replace(EDGE_PUNCTUATION, '')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLowerCase();
}

/** The command this utterance is, or null when it is ordinary text. */
export function matchCommand(text: string): VoiceCommandId | null {
	const normalized = normalize(text);
	if (normalized === '') return null;
	return PHRASES.get(normalized) ?? null;
}

/**
 * Split a closing "press enter" sentence off a dictation. `pressEnter` is true
 * only when words remain before it; the bare phrase is a whole-utterance
 * command and belongs to `matchCommand`. The body keeps its own sentence
 * punctuation ("Done? Press enter." ships "Done?").
 */
export function splitTrailingEnter(text: string): {
	body: string;
	pressEnter: boolean;
} {
	const match = TRAILING_ENTER.exec(text);
	if (match === null) return { body: text, pressEnter: false };
	// The match opens with the one sentence-end character, which the body keeps.
	const body = text.slice(0, match.index + 1).trim();
	if (body === '') return { body: text, pressEnter: false };
	return { body, pressEnter: true };
}
