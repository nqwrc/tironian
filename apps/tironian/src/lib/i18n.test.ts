import { describe, expect, it } from 'bun:test';
import { localeAction } from './i18n';

/**
 * The decision this covers is the one that is easy to get wrong in the direction
 * nobody notices: reloading when nothing needed reloading. A settings store that
 * emits on every open would turn that into a boot loop, so the "already correct"
 * cases are the ones worth pinning.
 */
describe('what to do when the setting and the rendered locale meet', () => {
	it('does nothing when the cache, the setting and the document already agree', () => {
		expect(localeAction('it', 'it', 'it')).toBe('none');
	});

	it('writes the cache without reloading on a first run, where nothing is cached and the default already matches the base locale', () => {
		expect(localeAction('en', 'en', null)).toBe('cache');
	});

	it('reloads when this document rendered in the wrong language, which is how a locale changed on another device arrives', () => {
		expect(localeAction('it', 'en', 'en')).toBe('reload');
	});

	it('reloads on a stale cache too, because the rendered locale is what the person is looking at, not the cache', () => {
		expect(localeAction('en', 'it', 'it')).toBe('reload');
	});

	it('repairs a cache that disagrees with a correctly rendered document without reloading', () => {
		// Storage was cleared, or written by a build with a different base locale.
		// The document is already right, so there is nothing for a person to see.
		expect(localeAction('en', 'en', 'it')).toBe('cache');
	});

	it('is idempotent: running it again after a cache write asks for nothing', () => {
		const first = localeAction('en', 'en', null);
		expect(first).toBe('cache');
		expect(localeAction('en', 'en', 'en')).toBe('none');
	});
});
