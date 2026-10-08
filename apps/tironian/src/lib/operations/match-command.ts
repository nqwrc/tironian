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
 * The suffix must stand apart from its sentence: after a full stop or a line
 * break, or after a comma when the sentence is not an instruction being
 * written down. "Type your password and press enter." and "To log in, press
 * enter." end in the phrase too, and a misfire there is the expensive kind:
 * Enter submits the cut-off text and the submit cannot be undone.
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
 * The Enter phrases at the close of a dictation: after a sentence end, a line
 * break, a comma or a semicolon, followed by nothing but a full stop, an
 * exclamation mark or an ellipsis. Recognizers set the pause before the phrase
 * as a full stop one time and a comma the next, so both have to count. A
 * question ("Press enter?") stays text, and so does the phrase inside a clause
 * ("... and press enter"), quotes or brackets. Bare "invio" is left out on
 * purpose: Italian "ti invio" ("I am sending you") ends ordinary sentences.
 */
const TRAILING_ENTER =
	/(?:([.!?…\n])|[,;])\s*(press\s+enter|premi\s+invio)[.!…\s]*$/iu;

/**
 * A sentence that opens with a purpose or a condition is an instruction being
 * written down, not a command: "To log in, press enter.", "If it asks, press
 * enter.", "Quando appare, premi invio." Checked only when a comma or a
 * semicolon joins the phrase to its sentence.
 */
const INSTRUCTION_LEAD =
	/^(?:to|in order to|if|when|once|after|before|then|and|per|se|quando|appena|dopo|prima|poi|e)\b/iu;

/** Where the sentence holding position `end` starts. */
function sentenceStart(text: string, end: number): number {
	const before = text.slice(0, end);
	const lastEnd = Math.max(
		before.lastIndexOf('.'),
		before.lastIndexOf('!'),
		before.lastIndexOf('?'),
		before.lastIndexOf('…'),
		before.lastIndexOf('\n'),
	);
	return lastEnd + 1;
}

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
	const sentenceEnd = match[1] !== undefined;
	if (!sentenceEnd) {
		const clause = text
			.slice(sentenceStart(text, match.index), match.index)
			.trim();
		if (INSTRUCTION_LEAD.test(clause)) return { body: text, pressEnter: false };
	}
	// A sentence end opens the match and stays with the body; a comma or a
	// semicolon only joined the phrase on, so it goes with it.
	const body = text.slice(0, match.index + (sentenceEnd ? 1 : 0)).trim();
	if (body === '') return { body: text, pressEnter: false };
	return { body, pressEnter: true };
}
