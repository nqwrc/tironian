/**
 * The text around the cursor when a dictation starts (ADR-0272), on the
 * webview side: whether to ask the host at all, how long to wait, what to
 * keep, and whether a model's answer repeated it.
 *
 * The host is an argument, so this module has no runtime `$lib` import and its
 * test mocks no module. The production call site is `recording.ts`.
 *
 * The slice is untrusted text from another app. It goes to the recognizer
 * prompt and the Polish system prompt and nowhere else: never to a recording
 * row, a log line, a notice, or analytics.
 */
import type {
	ContextService,
	CursorContextOutcome,
} from '$lib/services/context/types';

/** UTF-16 code units, the caps `cursor_context.rs` applies in the host. */
export const CURSOR_CONTEXT_CAPS = {
	before: 400,
	selection: 200,
	after: 200,
} as const;

/** How far a cut may move to land on a word boundary, as in the host. */
export const CURSOR_CONTEXT_WORD_SLACK = 40;

/**
 * Below the 1.5 s the correction learner waits (`field-read.ts`), because this
 * read sits on the dictation's critical path: the pipeline awaits it at stop.
 */
const READ_TIMEOUT_MS = 1000;

/** Runs of this many words count as repeated text. */
const ECHO_WORDS = 8;

export type CursorContext = {
	before: string;
	selection: string;
	after: string;
};

/** The one host call. Production passes `services.context`. */
export type CursorContextReader = Pick<ContextService, 'readContextAtCapture'>;

export type CursorContextHost = {
	/** The read is Windows only; the host refuses elsewhere too. */
	windows: boolean;
	reader: CursorContextReader;
	timeoutMs?: number;
};

/**
 * One read, or none. `enabled` is the person's switch. Never rejects: a
 * refusal, a rejection or a stall is `null`, which means "no context".
 */
export function captureCursorContext(
	host: CursorContextHost,
	enabled: boolean,
): Promise<CursorContext | null> {
	if (!host.windows || !enabled) return Promise.resolve(null);
	// A synchronous throw from the reader is a rejection too: capture start
	// must never fail because of this read.
	const read = new Promise<CursorContextOutcome>((resolve) =>
		resolve(host.reader.readContextAtCapture()),
	).then(
		(outcome: CursorContextOutcome) =>
			outcome.kind === 'context' ? clampCursorContext(outcome) : null,
		() => null,
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), host.timeoutMs ?? READ_TIMEOUT_MS);
	});
	return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

export function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

export function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function tail(text: string, cap: number): string {
	if (text.length <= cap) return text;
	const cut = text.slice(text.length - cap);
	return isLowSurrogate(cut.charCodeAt(0)) ? cut.slice(1) : cut;
}

function head(text: string, cap: number): string {
	if (text.length <= cap) return text;
	const cut = text.slice(0, cap);
	return isHighSurrogate(cut.charCodeAt(cut.length - 1))
		? cut.slice(0, -1)
		: cut;
}

/**
 * The host's caps, applied again, so no caller can hand a prompt more than the
 * host would. `null` when nothing but whitespace is left.
 */
export function clampCursorContext(raw: CursorContext): CursorContext | null {
	const context = {
		before: tail(raw.before, CURSOR_CONTEXT_CAPS.before),
		selection: head(raw.selection, CURSOR_CONTEXT_CAPS.selection),
		after: head(raw.after, CURSOR_CONTEXT_CAPS.after),
	};
	const blank =
		context.before.trim() === '' &&
		context.selection.trim() === '' &&
		context.after.trim() === '';
	return blank ? null : context;
}

function wordRuns(text: string): Set<string> {
	const words = text
		.normalize('NFC')
		.toLowerCase()
		.split(/\s+/)
		.map((word) => word.replace(/[\p{P}\p{S}]/gu, ''))
		.filter((word) => word !== '');
	const runs = new Set<string>();
	for (let index = 0; index + ECHO_WORDS <= words.length; index++) {
		runs.add(words.slice(index, index + ECHO_WORDS).join(' '));
	}
	return runs;
}

/**
 * Whether `output` repeats a run of eight words from the field that `source`
 * (what the speaker said) does not contain. Case, punctuation and symbols are
 * ignored.
 */
export function echoesCursorContext(
	output: string,
	source: string,
	context: CursorContext,
): boolean {
	const inOutput = wordRuns(output);
	if (inOutput.size === 0) return false;
	const inSource = wordRuns(source);
	for (const slice of [context.before, context.selection, context.after]) {
		for (const run of wordRuns(slice)) {
			if (inOutput.has(run) && !inSource.has(run)) return true;
		}
	}
	return false;
}

/**
 * Whether an error message from a provider quotes the field: a run of eight
 * words of it, whatever the speaker said. A message that does is replaced
 * with fixed copy before it reaches a notice, a log line or analytics.
 */
export function quotesCursorContext(
	message: string,
	context: CursorContext | null,
): boolean {
	return context !== null && echoesCursorContext(message, '', context);
}
