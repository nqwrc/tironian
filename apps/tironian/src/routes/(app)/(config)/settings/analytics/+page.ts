import { redirect } from '@sveltejs/kit';
import { dictationPath } from '$lib/constants/urls';

// Analytics merged into Account & data.
export function load() {
	redirect(308, dictationPath('/settings/account#analytics'));
}
