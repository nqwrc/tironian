/**
 * URL and pathname constants for the dictation app
 */
import { DICTATION_BASE_PATHNAME } from '#platform/base-path';

export { DICTATION_BASE_PATHNAME };

export function dictationPath(pathname: '/' | `/${string}`): string {
	return pathname === '/'
		? `${DICTATION_BASE_PATHNAME}/`
		: `${DICTATION_BASE_PATHNAME}${pathname}`;
}

export function normalizeDictationPath(pathname: string): string {
	if (
		pathname === DICTATION_BASE_PATHNAME ||
		pathname.startsWith(`${DICTATION_BASE_PATHNAME}/`)
	) {
		return pathname;
	}
	return dictationPath(
		pathname.startsWith('/') ? (pathname as `/${string}`) : `/${pathname}`,
	);
}

export const DICTATION_RECORDINGS_PATHNAME = dictationPath('/recordings');
