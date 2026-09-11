/**
 * The Dictionary folded into the recognizer's advisory prompt, bounded on the
 * routes that actually have a bound.
 *
 * Whisper's initial prompt is half the decoder context: 224 tokens of the 448.
 * Past that the provider truncates, and which end it cuts is not knowable from
 * here (whisper.cpp keeps the tail of the tokenized prompt, the hosted APIs
 * document nothing), and an over-long prompt can degrade the transcription
 * itself. On a Whisper route it is better to clip here, where the loss can be
 * named, than to let the wire clip it blind.
 *
 * That ceiling belongs to Whisper, not to every recognizer this app can select,
 * which is why the budget is resolved per route by `recognizerPromptCharBudget`
 * instead of applied once to everything. Two of the routes reachable from the
 * provider picker are not Whisper decoders at all: OpenAI's menu carries
 * `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` beside `whisper-1`, and
 * Deepgram receives this string as a `keyterm`/`keywords` query parameter with
 * no decoder context to overflow. Clipping those would remove terms from a
 * request that was carrying them fine, which is a regression rather than a
 * safeguard.
 *
 * The sibling `buildSystemPrompt` folds the same Dictionary into a completion
 * model's system prompt and is deliberately unbounded: that budget is four
 * orders of magnitude larger, and clipping it would drop terms for no reason.
 * Only the recognizer is short. See ADR-0099.
 */

import type { TranscriptionServiceId } from '$lib/services/transcription/provider-ids';

/**
 * Whisper's prompt ceiling: `n_text_ctx / 2`, which is 224 for every shipped
 * Whisper model. A recognizer fact, not a policy choice.
 */
const PROMPT_TOKEN_BUDGET = 224;

/**
 * Deliberately below GPT-2 BPE's roughly four characters per token on ordinary
 * English, because a Dictionary is the opposite of ordinary English: it is proper
 * nouns, product names, and jargon, exactly the strings BPE fragments hardest,
 * and it may hold scripts where one character costs more than one token. There is
 * no tokenizer in this app to ask, so the estimate takes the safe side and a
 * Latin-script dictionary loses a few terms it would strictly have fit. That
 * under-service is reported rather than silent, which is the trade worth taking.
 * A dictionary of pure CJK can still exceed the real token bound at this ratio;
 * the provider's own truncation stays the backstop for that case.
 */
const CONSERVATIVE_CHARS_PER_TOKEN = 3;

/** What a Whisper route measures against: 672 characters. */
export const WHISPER_PROMPT_CHAR_BUDGET =
	PROMPT_TOKEN_BUDGET * CONSERVATIVE_CHARS_PER_TOKEN;

/** Between glossary terms. The user prompt and the glossary are joined by one space. */
const TERM_SEPARATOR = ', ';

/**
 * What each transcription route does with this string.
 *
 * `whisper` decodes it as an initial prompt and carries the 224-token ceiling.
 * `other` receives it as something else, or not at all, and has no ceiling of
 * Whisper's to respect: Deepgram appends it as one `keyterm` (nova-3) or
 * `keywords` value, while ElevenLabs and Mistral take a prompt in their service
 * signatures and never put it on the wire, so a shorter string there can only
 * mean fewer terms biased for nothing. `by-model` is the one provider whose menu
 * spans both shapes.
 *
 * A record keyed by the id union rather than a switch with a default: a new
 * provider is a compile error here until somebody has decided which of the three
 * it is, which is the decision that was wrong when this bound was global.
 */
const PROMPT_SHAPE = {
	/** `whisper-1` beside the two `gpt-4o-transcribe` models. */
	OpenAI: 'by-model',
	/** Every model on the Groq menu is `whisper-large-v3`. */
	Groq: 'whisper',
	ElevenLabs: 'other',
	Deepgram: 'other',
	Mistral: 'other',
	/**
	 * whisper.cpp over a local GGUF. A local model that takes no prompt has it
	 * stripped by the host before inference, so the bound is moot there rather
	 * than wrong.
	 */
	local: 'whisper',
	/**
	 * A Whisper server by construction. The model id is the user's own string and
	 * cannot be checked ahead of the call, so this assumes the thing Speaches is
	 * for; pointing it at some other runtime costs a few tail terms.
	 */
	speaches: 'whisper',
} satisfies Record<TranscriptionServiceId, 'whisper' | 'other' | 'by-model'>;

/**
 * How many characters of prompt the selected route can take, or null when it has
 * no Whisper ceiling and the whole Dictionary should go out.
 *
 * Both the transcribe path and the Dictionary card on the dictation settings page
 * ask this, so what the person is told matches what the wire is handed.
 */
export function recognizerPromptCharBudget(
	service: TranscriptionServiceId,
	/**
	 * The model that will actually run, where the caller knows it. Read only for a
	 * `by-model` provider; null everywhere else, including from a caller that has
	 * not resolved one.
	 */
	model: string | null,
): number | null {
	switch (PROMPT_SHAPE[service]) {
		case 'whisper':
			return WHISPER_PROMPT_CHAR_BUDGET;
		case 'other':
			return null;
		case 'by-model':
			// Matched on the name, because an endpoint override can put any
			// OpenAI-compatible box behind this provider and there is no capability
			// call to ask. An unrecognized name goes unbounded on purpose: clipping a
			// recognizer with a larger window loses terms nobody agreed to lose, while
			// over-sending to a Whisper one is caught by the provider's own truncation.
			return model?.toLowerCase().includes('whisper')
				? WHISPER_PROMPT_CHAR_BUDGET
				: null;
	}
}

export type TranscriptionPrompt = {
	/** The string handed to the recognizer, already inside the budget. */
	prompt: string;
	/**
	 * The contiguous tail of the Dictionary that did not fit, in Dictionary order.
	 * Empty when everything fit, and always empty on an unbounded route. This is
	 * what turns a silent clip into something a person can see and act on.
	 */
	dropped: readonly string[];
};

/**
 * Fold the user's Dictionary into the transcription prompt.
 *
 * A null `charBudget` means the route has no Whisper ceiling, so every term is
 * emitted and nothing is dropped. The rest of this describes the bounded case.
 *
 * The user's own prompt always wins. It is the sentence they typed, in front of
 * them on the transcription settings page, and it is never shortened or dropped
 * for a glossary they may not have opened in months. When it fills the budget on
 * its own, no glossary is emitted at all: a fragment would push the whole string
 * further past the ceiling and buy nothing. A user prompt that is over budget by
 * itself still goes out whole, which is the one string this composer emits past
 * the budget, and it is theirs to shorten.
 *
 * Terms are kept whole, and the first one that does not fit ends the glossary.
 * A half-written proper noun biases the recognizer toward a spelling the user
 * never asked for, which is worse than the term being absent. Stopping at the
 * first miss rather than skipping ahead to shorter terms is what makes the loss
 * explainable: what did not fit is always a run from one term to the end of the
 * list, so the answer is "everything from here down", not a scattered set.
 */
export function buildTranscriptionPrompt(
	userPrompt: string,
	/** Null when the person has added no terms: the definition cannot default an array. */
	dictionary: readonly string[] | null,
	/** From `recognizerPromptCharBudget`. Null leaves the Dictionary whole. */
	charBudget: number | null,
): TranscriptionPrompt {
	const trimmed = userPrompt.trim();
	const terms = dictionary ?? [];
	if (terms.length === 0) return { prompt: trimmed, dropped: [] };
	if (charBudget === null) return joined(trimmed, terms, []);
	if (trimmed.length >= charBudget) return { prompt: trimmed, dropped: terms };

	// One space joins the user prompt to the first term, so it is charged up front
	// and only when there is a user prompt to join.
	let remaining = charBudget - trimmed.length - (trimmed ? 1 : 0);
	const kept: string[] = [];
	let dropped: readonly string[] = [];

	for (const [index, term] of terms.entries()) {
		const cost = term.length + (kept.length > 0 ? TERM_SEPARATOR.length : 0);
		if (cost > remaining) {
			dropped = terms.slice(index);
			break;
		}
		remaining -= cost;
		kept.push(term);
	}

	return joined(trimmed, kept, dropped);
}

function joined(
	trimmed: string,
	kept: readonly string[],
	dropped: readonly string[],
): TranscriptionPrompt {
	const glossary = kept.join(TERM_SEPARATOR);
	if (!glossary) return { prompt: trimmed, dropped };
	return {
		prompt: trimmed ? `${trimmed} ${glossary}` : glossary,
		dropped,
	};
}
