/**
 * The seam between the `interfaceLocale` setting and the Paraglide runtime.
 *
 * Two stores hold the locale, and they are not redundant. The setting in the
 * workspace is the authority: it is what the person chose, and it converges
 * across their devices like every other setting. `localStorage` is a local
 * cache of that choice, and it exists because of when it can be read. Messages
 * resolve during the first paint, and the workspace store is not open yet at
 * that point; `localStorage` is synchronous and is. The app already runs this
 * exact pattern for the theme, in the inline script in `app.html`, for the same
 * reason and with the same shape.
 *
 * The cost of a cache is that it can disagree with its authority: a locale
 * changed on another device arrives through sync after this document has
 * already rendered in the old one. That is what {@link localeAction} decides,
 * and the answer is a reload rather than a re-render. Paraglide compiles
 * messages to plain functions, so nothing in Svelte re-runs when the locale
 * changes; making the whole interface reactive to it would mean threading a
 * signal through every call site to serve an action a person takes about twice
 * in the life of an install. Reloading is what the library does by default, and
 * a desktop webview reload is cheap.
 */

// Relative, not `$lib`: `$lib` has no runtime resolution under `bun test`, and
// the compiled runtime is not a module worth faking to get a suite to start.
import { getLocale, locales, setLocale } from './paraglide/runtime';

/** The locales the app has messages for. Narrowed from Paraglide's readonly tuple. */
export type InterfaceLocale = (typeof locales)[number];

/**
 * What to do about a disagreement between the setting and what this document
 * actually rendered in.
 *
 * - `none`: they agree, which is the overwhelmingly common case.
 * - `cache`: the cache is missing or stale but the rendered locale is already
 *   right, so writing it is enough and the person sees nothing. This is the
 *   first-run path, where nothing has been cached and the default setting
 *   happens to match Paraglide's base locale.
 * - `reload`: this document is rendered in the wrong language. Write the cache,
 *   then reload so every screen changes at once instead of leaving a half
 *   translated interface behind.
 */
export type LocaleAction = 'none' | 'cache' | 'reload';

/**
 * Pure so the decision can be tested without a DOM. `rendered` is the locale
 * this document actually resolved at first paint, and `cached` is what is
 * currently in storage; they differ on the very first run, when nothing is
 * cached and Paraglide fell back to the base locale.
 */
export function localeAction(
	setting: InterfaceLocale,
	rendered: string,
	cached: string | null,
): LocaleAction {
	if (rendered !== setting) return 'reload';
	return cached === setting ? 'none' : 'cache';
}

/** Paraglide's own key, so the cache this writes is the one it reads. */
export const LOCALE_CACHE_KEY = 'PARAGLIDE_LOCALE';

/**
 * Reconcile the running document with the setting.
 *
 * Call this once the workspace store has produced a settings value, and again
 * whenever that value changes: both cases are the same question, and both are
 * answered by {@link localeAction}. Storage can throw in a locked-down browser
 * profile, and a locale that cannot be cached is not worth failing a boot over,
 * so a write that throws degrades to leaving the document as it is.
 */
export function reconcileLocale(setting: InterfaceLocale): LocaleAction {
	let cached: string | null = null;
	try {
		cached = localStorage.getItem(LOCALE_CACHE_KEY);
	} catch {
		// A profile that refuses storage gets the base locale every load. That is
		// a worse experience than a cached one and a better one than no app.
	}

	const action = localeAction(setting, getLocale(), cached);
	if (action === 'none') return action;

	try {
		localStorage.setItem(LOCALE_CACHE_KEY, setting);
	} catch {
		return 'none';
	}

	// `setLocale` writes through the configured strategies and reloads the
	// document by default, which is exactly the behavior wanted here. The cache
	// is written above as well so the value survives even if the reload is
	// suppressed by the host.
	if (action === 'reload') setLocale(setting);
	return action;
}
