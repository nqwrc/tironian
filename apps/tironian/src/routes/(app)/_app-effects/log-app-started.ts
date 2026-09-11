import { onMount } from 'svelte';
import type { TironianApp } from '$lib/app/app';
import { logAnalyticsEvent } from '$lib/operations/analytics';

/** Log the one `app_started` analytics event per launch, once mounted. */
export function logAppStarted(app: TironianApp): void {
	onMount(() => {
		void logAnalyticsEvent(app, { type: 'app_started' });
	});
}
