/**
 * The string a recognizer is handed as its advisory prompt: the person's own
 * prompt, the Dictionary, and, on routes that read a prompt as the transcript
 * so far, the text before the cursor (ADR-0272).
 *
 * `transcribe.ts` reads settings and calls this with plain values. The
 * decision of which routes get the text before the cursor lives here, with no
 * service or platform import, so a test can pin it for every route without
 * mocking a module.
 */

import type { TranscriptionServiceId } from '$lib/services/transcription/provider-ids';
import {
	buildTranscriptionPrompt,
	recognizerPromptCharBudget,
	recognizerTakesPrecedingText,
	type TranscriptionPrompt,
} from './build-transcription-prompt';
import type { CursorContext } from './cursor-context-core';

export function composeRecognizerPrompt({
	userPrompt,
	dictionary,
	service,
	model,
	cursorContext,
}: {
	userPrompt: string;
	dictionary: readonly string[] | null;
	service: TranscriptionServiceId;
	/** The model about to run, where the caller has resolved one. */
	model: string | null;
	/** Only `before` is used, and only where the route takes it. */
	cursorContext: CursorContext | null;
}): TranscriptionPrompt {
	return buildTranscriptionPrompt(
		userPrompt,
		dictionary,
		recognizerPromptCharBudget(service, model),
		recognizerTakesPrecedingText(service)
			? (cursorContext?.before ?? null)
			: null,
	);
}
