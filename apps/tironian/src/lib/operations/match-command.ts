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
 * See `specs/20260829T120000-command-mode.md`.
 */

export type VoiceCommandId = 'scratchThat' | 'stopListening';

/**
 * The spoken phrases, already in normalized form. Fixed in code rather than
 * user data: snippets are the user's content, commands are app behavior.
 */
const PHRASES: Map<string, VoiceCommandId> = new Map([
	['scratch that', 'scratchThat'],
	['undo that', 'scratchThat'],
	['stop listening', 'stopListening'],
]);

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
