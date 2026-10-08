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

/** Of a repeated run, this many words must be the speaker's for it to be theirs. */
const ECHO_MIN_SHARED_WORDS = 5;

/** The run length in a script without spaces, where words cannot count. */
const ECHO_CHARS = 16;

/** Of such a run's 15 adjacent character pairs, how many must be the speaker's. */
const ECHO_MIN_SHARED_PAIRS = 10;

/** An error that quotes this many words of the field is scrubbed. */
const ERROR_WORDS = 4;

/** Or this many characters of the folded field. */
const ERROR_CHARS = 20;

export type CursorContext = {
	before: string;
	selection: string;
	after: string;
};

/**
 * A one-shot holder for the slice while a run carries it (ADR-0272). The
 * capture queue and the pipeline input hold this, never the text itself, and
 * the pipeline empties it right after Polish, so nothing the run keeps
 * references the slice while the paste lands. It is a reference drop, not
 * zeroing: JavaScript offers no stronger guarantee.
 */
export type CursorContextHolder = {
	/** The slice, or null once cleared. */
	read: () => CursorContext | null;
	/** Drops the reference; every later read answers null. */
	clear: () => void;
};

/** `null` stays `null`: a capture with no context has nothing to hold. */
export function holdCursorContext(
	context: CursorContext | null,
): CursorContextHolder | null {
	if (context === null) return null;
	const box: { held: CursorContext | null } = { held: context };
	return {
		read: () => box.held,
		clear: () => {
			box.held = null;
		},
	};
}

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

/** The JSON escapes a provider's error body can carry the text in. */
const ESCAPE = /\\(?:u([0-9a-fA-F]{4})|([nrt"\\/]))/g;
const ESCAPED: Record<string, string> = {
	n: '\n',
	r: '\r',
	t: '\t',
	'"': '"',
	'\\': '\\',
	'/': '/',
};

/** `\n`, `\"`, `\\` and `è`, as typed in an error body, become the characters. */
function decodeEscapes(text: string): string {
	let current = text;
	// Three passes undo a body that was escaped inside another escaped body.
	for (let pass = 0; pass < 3; pass++) {
		const next = current.replace(
			ESCAPE,
			(_match, hex?: string, char?: string) =>
				hex === undefined
					? (ESCAPED[char ?? ''] ?? '')
					: String.fromCharCode(Number.parseInt(hex, 16)),
		);
		if (next === current) break;
		current = next;
	}
	return current;
}

/** Scripts written without spaces between words, where words cannot count. */
const UNSPACED_SCRIPT =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

type Folded = {
	/** Lower case, accents and punctuation gone, split on whitespace. */
	words: string[];
	/** The same text with no whitespace or punctuation at all. */
	stripped: string;
	/** Mostly a script without spaces, so character runs stand in for words. */
	unspaced: boolean;
};

/**
 * The one fold every comparison here uses: JSON escapes decoded, accents and
 * case dropped, punctuation and symbols read as spaces.
 */
function fold(text: string): Folded {
	const words = decodeEscapes(text)
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[\p{P}\p{S}]/gu, ' ')
		.split(/\s+/)
		.filter((word) => word !== '');
	const stripped = words.join('');
	const unspacedChars = stripped.match(UNSPACED_SCRIPT)?.length ?? 0;
	return {
		words,
		stripped,
		unspaced: stripped.length > 0 && unspacedChars * 2 >= stripped.length,
	};
}

function wordRuns(words: readonly string[], size: number): string[] {
	const runs: string[] = [];
	for (let index = 0; index + size <= words.length; index++) {
		runs.push(words.slice(index, index + size).join(' '));
	}
	return runs;
}

function charRuns(text: string, size: number): string[] {
	const runs: string[] = [];
	for (let index = 0; index + size <= text.length; index++) {
		runs.push(text.slice(index, index + size));
	}
	return runs;
}

function foldSlices(context: CursorContext): Folded[] {
	return [context.before, context.selection, context.after].map(fold);
}

/**
 * Whether `output` repeats text from the field that the speaker did not say.
 * An echo is Polish adding field words, not Polish editing the speaker's: a
 * run of eight words that the field also holds is an echo only when fewer than
 * five of those eight words appear anywhere in `source` (what the speaker
 * said). A spelling fix to a name, a dropped filler, a re-dictated selection
 * with a self-correction and "three" turned into "3" all keep at least five.
 *
 * Text in a script without spaces compares 16-character runs the same way: a
 * run is an echo when fewer than 10 of its 15 adjacent character pairs occur
 * in `source`. Case, accents, punctuation and symbols are ignored.
 */
export function echoesCursorContext(
	output: string,
	source: string,
	context: CursorContext,
): boolean {
	const written = fold(output);
	if (written.words.length === 0) return false;
	const said = fold(source);
	const saidWords = new Set(said.words);
	const saidPairs = new Set(charRuns(said.stripped, 2));
	for (const field of foldSlices(context)) {
		if (field.unspaced) {
			const inField = new Set(charRuns(field.stripped, ECHO_CHARS));
			for (const run of charRuns(written.stripped, ECHO_CHARS)) {
				if (!inField.has(run)) continue;
				const shared = charRuns(run, 2).filter((pair) => saidPairs.has(pair));
				if (shared.length < ECHO_MIN_SHARED_PAIRS) return true;
			}
			continue;
		}
		const inField = new Set(wordRuns(field.words, ECHO_WORDS));
		for (let index = 0; index + ECHO_WORDS <= written.words.length; index++) {
			const run = written.words.slice(index, index + ECHO_WORDS);
			if (!inField.has(run.join(' '))) continue;
			const shared = run.filter((word) => saidWords.has(word)).length;
			if (shared < ECHO_MIN_SHARED_WORDS) return true;
		}
	}
	return false;
}

/**
 * Whether an error message from a provider quotes the field. The speaker's
 * words do not excuse it here, since an error should quote nothing: any run of
 * four words of the field, or of 20 characters of it (16 in a script without
 * spaces), counts, after JSON escapes are decoded. A message that does is
 * replaced with fixed copy before it reaches a notice, a log line, a recording
 * row or analytics.
 */
export function quotesCursorContext(
	message: string,
	context: CursorContext | null,
): boolean {
	if (context === null) return false;
	const quoted = fold(message);
	if (quoted.words.length === 0) return false;
	const text = quoted.words.join(' ');
	const words = new Set(wordRuns(quoted.words, ERROR_WORDS));
	const grams = new Set(charRuns(quoted.stripped, ECHO_CHARS));
	for (const field of foldSlices(context)) {
		if (field.unspaced) {
			if (charRuns(field.stripped, ECHO_CHARS).some((run) => grams.has(run))) {
				return true;
			}
			continue;
		}
		if (wordRuns(field.words, ERROR_WORDS).some((run) => words.has(run))) {
			return true;
		}
		const spelled = field.words.join(' ');
		if (charRuns(spelled, ERROR_CHARS).some((run) => text.includes(run))) {
			return true;
		}
	}
	return false;
}
