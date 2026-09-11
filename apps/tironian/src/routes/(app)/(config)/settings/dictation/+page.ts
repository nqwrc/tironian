import { redirect } from '@sveltejs/kit';
import { dictationPath } from '$lib/constants/urls';

// Dictation stopped being a settings page and became a top-level section. This
// keeps bookmarks and links that were handed out under the old path working.
export function load() {
	redirect(308, dictationPath('/dictation'));
}
