import { createSubscriber } from 'svelte/reactivity';
import type { TironianSettings } from '$lib/app/app';
import type { TironianSettingValues } from '$lib/workspace';

export type BooleanSettingKey = {
	[K in keyof TironianSettingValues]: TironianSettingValues[K] extends boolean
		? K
		: never;
}[keyof TironianSettingValues];

/**
 * Reactive view over the app's hydrated settings: same interface,
 * but reads performed inside a template, `$derived`, or `$effect` re-run
 * when a bound Data value commits. The subscription is ref-counted to effect
 * usage via `createSubscriber`, so an unmounted tree holds no listener.
 */
export function createSettingsView(
	settings: TironianSettings,
): TironianSettings {
	const invalidate = createSubscriber((update) => settings.subscribe(update));
	return {
		get(key) {
			invalidate();
			return settings.get(key);
		},
		set: settings.set,
		getDefault: settings.getDefault,
		reset: settings.reset,
		subscribe: settings.subscribe,
	};
}
