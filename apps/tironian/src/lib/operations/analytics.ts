import type { TironianApp } from '$lib/app/app';
import { services } from '$lib/services';
import type { Event } from '$lib/services/analytics/types';

/**
 * Log an anonymous analytics event if analytics is enabled in settings.
 */
export async function logAnalyticsEvent(
	app: TironianApp,
	event: Event,
): Promise<void> {
	if (!app.settings.get('analyticsEnabled')) return;
	await services.analytics.logEvent(event);
}
