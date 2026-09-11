import { tauri } from '#platform/tauri';
import type { TironianApp } from '$lib/app/app';
import {
	TRANSCRIPTION_PROVIDERS,
	type TranscriptionProviderEntry,
} from '$lib/services/transcription/provider-ui';
import { deviceConfig } from '$lib/state/device-config.svelte';
import { localRoute } from '$lib/state/local-route.svelte';
import { secrets } from '$lib/state/secrets.svelte';

function hasValue(value: string) {
	return value.trim() !== '';
}

/**
 * The host's own sentence for why the local route cannot run, or `null` when it
 * can. Presented verbatim: the host reports the fact, and it is written to name
 * no model, because model identity is administration data (ADR-0180).
 */
export function getLocalRouteBlocker(): string | null {
	return localRoute.result?.error?.message ?? null;
}

export function getSelectedTranscriptionProvider(
	app: TironianApp,
): TranscriptionProviderEntry | undefined {
	const selectedServiceId = app.settings.get('transcriptionService');
	return TRANSCRIPTION_PROVIDERS.find((s) => s.id === selectedServiceId);
}

export function isTranscriptionServiceAvailable(
	service: TranscriptionProviderEntry,
): boolean {
	return Boolean(tauri) || service.access !== 'onDevice';
}

/**
 * Gets the currently selected transcription service.
 * Returns undefined if the service is not available on this platform.
 *
 * @returns The selected transcription service, or undefined if none selected or invalid
 */
export function getSelectedTranscriptionService(
	app: TironianApp,
): TranscriptionProviderEntry | undefined {
	const service = getSelectedTranscriptionProvider(app);
	if (service && !isTranscriptionServiceAvailable(service)) return undefined;
	return service;
}

/**
 * Whether a transcription service is usable right now. The required key is the
 * provider's own config key (apiKey / endpoint / model), read from its registry
 * entry. A `key` provider's API key is a secret read through the credential facade,
 * so "usable" means `available`.
 *
 * @param service - The transcription service to check
 * @returns true if the service is usable, false otherwise
 */
export function isTranscriptionServiceConfigured(
	service: TranscriptionProviderEntry,
): boolean {
	switch (service.access) {
		case 'key':
			return secrets.get(service.apiKeyConfigKey).status === 'available';
		case 'endpoint':
			return (
				hasValue(deviceConfig.get(service.endpointConfigKey)) &&
				hasValue(deviceConfig.get(service.modelIdConfigKey))
			);
		case 'onDevice':
			// The local route needs no app-side configuration at all: there is no
			// key, no endpoint, and no model for Tironian to set. On desktop it is
			// always "configured", so it stays selectable even when the host cannot
			// currently run it. That is deliberate (ADR-0180): a selectable route
			// that warns is what lets the warning happen before capture, and hiding
			// the route would leave the user with nothing to warn about.
			return true;
	}
}

export type TranscriptionReadiness = {
	/** True when the selected service is available here and fully configured. */
	isReady: boolean;
	/** The single most relevant blocker to show the user, or null when ready. */
	primaryIssue: string | null;
};

/**
 * The blocker Tironian can be certain of before any audio is captured or
 * sent, or `null` when there is nothing it knows to be wrong: no service
 * chosen, a service this platform cannot run, or one whose credential is
 * missing. Every input is a synchronous read of local state, so this answers
 * the same way at a shortcut press as it does a second later.
 *
 * Deliberately narrower than {@link getTranscriptionReadiness}, which also
 * reports the host's local-route blocker. That blocker is host-advised and can
 * be stale, and the host owns on-device failure at the point of use with a
 * message that names the fix (ADR-0180), so a pre-flight check must never
 * refuse a local transcription the host would have run. The on-device route
 * therefore passes this gate unconditionally and fails, if it fails, in the
 * host's own words.
 */
export function getTranscriptionPreflightBlocker(
	app: TironianApp,
): string | null {
	const service = getSelectedTranscriptionProvider(app);
	if (!service) return 'Choose a transcription service.';

	if (!isTranscriptionServiceAvailable(service)) {
		return `${service.label} is only available in the desktop app.`;
	}

	if (service.access === 'onDevice') return null;
	if (isTranscriptionServiceConfigured(service)) return null;

	return {
		key: `Add your ${service.label} API key.`,
		endpoint: `Set your ${service.label} endpoint and model ID.`,
	}[service.access];
}

export function getTranscriptionReadiness(
	app: TironianApp,
): TranscriptionReadiness {
	const blocker = getTranscriptionPreflightBlocker(app);
	if (blocker !== null) return { isReady: false, primaryIssue: blocker };

	// On-device readiness is host-advised and optimistic during the first read: a
	// not-yet-answered host must not flash a warning for a route that resolves to
	// `ready` a tick later. The blocker is the host's own sentence, shown as-is.
	// This is the one fact the pre-flight gate above leaves out, because a screen
	// can afford to warn about it and a capture cannot afford to refuse on it.
	if (getSelectedTranscriptionProvider(app)?.access === 'onDevice') {
		const hostBlocker = getLocalRouteBlocker();
		if (hostBlocker !== null) {
			return { isReady: false, primaryIssue: hostBlocker };
		}
	}

	return { isReady: true, primaryIssue: null };
}
