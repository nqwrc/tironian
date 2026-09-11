/**
 * Transcription pre-flight tests.
 *
 * The pre-flight blocker is what every capture entry point consults before it
 * records, so these pin two things: the sentence a person is given for each way
 * a provider can be unusable, and the one case the gate must never refuse.
 *
 * That case is the on-device route. Its failures belong to the host, which
 * describes them at the point of use (ADR-0180), and the host's advice can be
 * stale. A pre-flight check that acted on it would refuse captures the host
 * would have transcribed, so the blocker ignores it and readiness does not.
 */
import { afterEach, expect, mock, test } from 'bun:test';

type ProviderFixture = {
	id: string;
	label: string;
	access: 'key' | 'endpoint' | 'onDevice';
	apiKeyConfigKey?: string;
	endpointConfigKey?: string;
	modelIdConfigKey?: string;
};

const PROVIDERS: ProviderFixture[] = [
	{
		id: 'OpenAI',
		label: 'OpenAI',
		access: 'key',
		apiKeyConfigKey: 'OpenAI.apiKey',
	},
	{
		id: 'speaches',
		label: 'Speaches',
		access: 'endpoint',
		endpointConfigKey: 'speaches.baseUrl',
		modelIdConfigKey: 'speaches.modelId',
	},
	{ id: 'local', label: 'Local', access: 'onDevice' },
];

let storedSecrets: Record<string, string> = {};
let storedConfig: Record<string, string> = {};
let hostBlocker: string | null = null;

// The platform seam is an import-time constant, so a single module instance
// cannot be both builds; the web case has its own file beside this one.
mock.module('#platform/tauri', () => ({ tauri: {} }));
mock.module('$lib/services/transcription/provider-ui', () => ({
	TRANSCRIPTION_PROVIDERS: PROVIDERS,
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: { get: (key: string) => storedConfig[key] ?? '' },
}));
mock.module('$lib/state/local-route.svelte', () => ({
	localRoute: {
		get result() {
			return hostBlocker === null
				? undefined
				: { error: { message: hostBlocker } };
		},
	},
}));
mock.module('$lib/state/secrets.svelte', () => ({
	secrets: {
		get: (key: string) =>
			storedSecrets[key]
				? { status: 'available', value: storedSecrets[key] }
				: { status: 'missing' },
	},
}));

const { getTranscriptionPreflightBlocker, getTranscriptionReadiness } =
	await import('./transcription-validation.js');
type TironianApp = import('$lib/app/app').TironianApp;

/** An app whose only fact these functions read is the selected service. */
function appWith(transcriptionService: string): TironianApp {
	return {
		settings: { get: () => transcriptionService },
	} as unknown as TironianApp;
}

afterEach(() => {
	storedSecrets = {};
	storedConfig = {};
	hostBlocker = null;
});

test('an unknown or unset service asks for one to be chosen', () => {
	expect(getTranscriptionPreflightBlocker(appWith(''))).toBe(
		'Choose a transcription service.',
	);
});

test('a key provider asks for its key, by name, until one is stored', () => {
	expect(getTranscriptionPreflightBlocker(appWith('OpenAI'))).toBe(
		'Add your OpenAI API key.',
	);

	storedSecrets['OpenAI.apiKey'] = 'sk-test';
	expect(getTranscriptionPreflightBlocker(appWith('OpenAI'))).toBeNull();
});

test('a self-hosted provider needs both an endpoint and a model', () => {
	const expected = 'Set your Speaches endpoint and model ID.';
	expect(getTranscriptionPreflightBlocker(appWith('speaches'))).toBe(expected);

	storedConfig['speaches.baseUrl'] = 'http://localhost:8000';
	expect(getTranscriptionPreflightBlocker(appWith('speaches'))).toBe(expected);

	storedConfig['speaches.modelId'] = 'Systran/faster-whisper-tiny';
	expect(getTranscriptionPreflightBlocker(appWith('speaches'))).toBeNull();
});

test('the on-device route is never refused, even while the host reports a blocker', () => {
	hostBlocker = 'No model is active.';

	// The gate every capture consults stays silent: the host owns this failure
	// and describes it at the point of use (ADR-0180).
	expect(getTranscriptionPreflightBlocker(appWith('local'))).toBeNull();

	// A screen can afford to say it, so readiness still does, in the host's
	// own sentence.
	expect(getTranscriptionReadiness(appWith('local'))).toEqual({
		isReady: false,
		primaryIssue: 'No model is active.',
	});
});

test('readiness reports the pre-flight blocker when there is one', () => {
	expect(getTranscriptionReadiness(appWith('OpenAI'))).toEqual({
		isReady: false,
		primaryIssue: 'Add your OpenAI API key.',
	});

	storedSecrets['OpenAI.apiKey'] = 'sk-test';
	expect(getTranscriptionReadiness(appWith('OpenAI'))).toEqual({
		isReady: true,
		primaryIssue: null,
	});
});
