/**
 * The pre-flight blocker on a web build.
 *
 * Separate from `transcription-validation.test.ts` because the platform seam is
 * an import-time constant: one module instance is either the desktop build or
 * the web one, and this is the case where `tauri` is absent. The on-device
 * route is the only provider the platform can rule out, and it is the same
 * route the desktop file proves is never refused, so both halves of that rule
 * need a build of their own to be stated.
 */
import { expect, mock, test } from 'bun:test';

const PROVIDERS = [
	{ id: 'local', label: 'Local', access: 'onDevice' },
	{
		id: 'OpenAI',
		label: 'OpenAI',
		access: 'key',
		apiKeyConfigKey: 'OpenAI.apiKey',
	},
];

mock.module('#platform/tauri', () => ({ tauri: null }));
mock.module('$lib/services/transcription/provider-ui', () => ({
	TRANSCRIPTION_PROVIDERS: PROVIDERS,
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: { get: () => '' },
}));
mock.module('$lib/state/local-route.svelte', () => ({
	localRoute: { result: undefined },
}));
mock.module('$lib/state/secrets.svelte', () => ({
	secrets: { get: () => ({ status: 'missing' }) },
}));

const { getTranscriptionPreflightBlocker } = await import(
	'./transcription-validation.js'
);
type WhisperingApp = import('$lib/whispering/app').WhisperingApp;

function appWith(transcriptionService: string): WhisperingApp {
	return {
		settings: { get: () => transcriptionService },
	} as unknown as WhisperingApp;
}

test('a desktop-only service names the platform on web', () => {
	expect(getTranscriptionPreflightBlocker(appWith('local'))).toBe(
		'Local is only available in the desktop app.',
	);
});

test('a cloud provider is still judged on its credential, not the platform', () => {
	expect(getTranscriptionPreflightBlocker(appWith('OpenAI'))).toBe(
		'Add your OpenAI API key.',
	);
});
