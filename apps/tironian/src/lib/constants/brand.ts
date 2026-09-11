/**
 * The product's name, in one place.
 *
 * The name reached this file after being spelled out in forty user-visible
 * strings, which is what made the last rename a survey instead of an edit.
 * Anything a person reads that is *only* the name (a window title, a tab title,
 * a tooltip, a connect dialog's app label) reads it from here.
 *
 * Prose does not. A sentence like "Tironian pauses media playing on your
 * computer" stays a literal in its component, because interpolating a constant
 * into every clause buys one grep and costs the readability of every settings
 * page. The rule is: interpolate the name when the name is the whole string,
 * write it when it is a word in a sentence.
 *
 * One exception, and it is unavoidable: `src/app.html` is static HTML served
 * before any module loads, so its `<title>` carries the literal. That is the
 * only copy of the name outside this file that a rename has to remember.
 *
 * Internal identifiers (`TironianApp`, `$lib/app/*`, `@tironian/app`) are
 * renamed too, as of the directory and identifier pass on `feature/debrand`.
 * See `docs/brand/tironian.md`, "Naming": the fork-tracking constraint that
 * once justified leaving them under the upstream names no longer applies now
 * that this branch has stopped taking upstream merges.
 */

/** The wordmark. Never abbreviated, never sub-branded. */
export const PRODUCT_NAME = 'Tironian';

/**
 * U+204A, the Tironian et: the one sign from the first Western shorthand system
 * still in daily use. The app mark, and the only glyph the tray, the favicon and
 * the wordmark share.
 */
export const PRODUCT_MARK = '⁊';

/** The header line. `docs/brand/tironian.md` holds the alternates and the reasons. */
export const TAGLINE = 'Dictation you own.';

/**
 * A browser tab title.
 *
 * Called with no argument on the root pages, so the home tab and the shell both
 * read as the bare product name rather than "Tironian - Tironian".
 */
export function pageTitle(section?: string): string {
	return section ? `${section} - ${PRODUCT_NAME}` : PRODUCT_NAME;
}
