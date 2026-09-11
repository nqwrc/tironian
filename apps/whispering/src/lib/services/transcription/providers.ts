/**
 * The single source of truth for transcription providers. One entry per
 * provider owns every fact: label, access, models, capabilities, and the
 * deviceConfig/settings key NAMES used to read its config (never the values,
 * which the dispatcher in `operations/transcribe.ts` reads).
 *
 * Pointer-field naming: the suffix names the store. A `*ConfigKey` field
 * holds the name of a `deviceConfig` entry (device-local, never synced); a
 * `*SettingKey` field holds the name of a `settings` entry (synced workspace
 * KV). Dispatchers resolve the pointer against the matching store.
 *
 * Behavior is deliberately not here. The `id -> transcribe` wiring lives as a
 * static table in the dispatcher, where the provider SDKs already load. That
 * keeps this record free of SDK imports so the workspace schema can import
 * `TRANSCRIPTION_SERVICE_IDS` without bundling them. Icons and the UI-facing
 * join live in `./provider-ui.ts` (icons being the one field heavy enough to
 * pollute that import).
 */

import type {
	DeviceConfigKey,
	SecretKey,
} from '$lib/state/device-config.svelte';
import { m } from '../../paraglide/messages';
import type { TranscriptionServiceId } from './provider-ids';

export {
	TRANSCRIPTION_SERVICE_IDS,
	type TranscriptionServiceId,
} from './provider-ids';

type Capabilities = { supportsPrompt: boolean; supportsLanguage: boolean };
type CloudModel = { name: string; description: string; cost: string };

/**
 * `access` is the per-family discriminant every dispatcher, selector, and readiness
 * check branches on. Each member names what the user supplies to make a provider
 * usable, so it maps one-to-one to what `isTranscriptionServiceConfigured` reads:
 *
 *   - `key`      the user's own API key (a secret)         -> OpenAI, Groq, ...
 *   - `endpoint` a server URL + model id the user runs     -> Speaches
 *   - `onDevice` nothing but the device: an on-device       -> Local
 *                model file, no network
 *
 * `key` and `endpoint` are the matched pair: both hand a `{ baseUrl, apiKey? }` to
 * an external OpenAI-compatible box, differing only in whether the user brings a
 * key (the vendor's compute) or an endpoint (their own box).
 */
export type ProviderAccess = 'key' | 'endpoint' | 'onDevice';

type KeyProvider = {
	access: Extract<ProviderAccess, 'key'>;
	label: string;
	description: string;
	capabilities: Capabilities;
	models: readonly CloudModel[];
	defaultModel: string;
	/**
	 * The provider's API key: a secret, so it routes through the credential
	 * facade (`secrets.get`), not raw `deviceConfig`. `SecretKey` (not the wider
	 * `DeviceConfigKey`) makes that structural, per ADR-0074.
	 */
	apiKeyConfigKey: SecretKey;
	/**
	 * The settings key holding this provider's model selection. Constrained to
	 * the shape `transcription<Provider>Model` rather than a precise union of
	 * the cloud keys: a precise union here would make `typeof PROVIDERS`
	 * reference a type derived from itself (`satisfies Record<...>` closes the
	 * loop). The real guard is the call site `settings.get(modelSettingKey)`,
	 * which rejects a key the workspace does not declare.
	 */
	modelSettingKey: `transcription${string}Model`;
	/** Device config key for the endpoint override; null when not configurable. */
	endpointConfigKey: DeviceConfigKey | null;
	/**
	 * Where this provider documents its transcription models; null when the
	 * provider has no good page to link. The settings page renders this under
	 * the model picker.
	 */
	modelsDoc: { label: string; href: string } | null;
};

type OnDeviceProvider = {
	access: Extract<ProviderAccess, 'onDevice'>;
	label: string;
	description: string;
	// No model pointer and no static `capabilities`: the host owns the one
	// active local model (ADR-0180), and its per-model capability is read from
	// that model at use, not declared provider-wide the way a cloud family's is.
};

type EndpointProvider = {
	access: Extract<ProviderAccess, 'endpoint'>;
	label: string;
	description: string;
	capabilities: Capabilities;
	endpointConfigKey: DeviceConfigKey;
	modelIdConfigKey: DeviceConfigKey;
};

type TranscriptionProvider = KeyProvider | OnDeviceProvider | EndpointProvider;

export const PROVIDERS = {
	OpenAI: {
		access: 'key',
		label: 'OpenAI',
		description: m.providers_industry_standard_whisper_api(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		apiKeyConfigKey: 'providers.openai.apiKey',
		modelSettingKey: 'transcriptionOpenaiModel',
		endpointConfigKey: 'providers.openai.endpoint',
		modelsDoc: {
			label: 'OpenAI docs',
			href: 'https://platform.openai.com/docs/guides/speech-to-text',
		},
		defaultModel: 'whisper-1',
		models: [
			{
				name: 'whisper-1',
				description: m.providers_openai_s_flagship_speech_to_text_model_with(),
				cost: '$0.36/hour',
			},
			{
				name: 'gpt-4o-transcribe',
				description: m.providers_gpt_4o_powered_transcription_with_enhanced(),
				cost: '$0.36/hour',
			},
			{
				name: 'gpt-4o-mini-transcribe',
				description: m.providers_cost_effective_gpt_4o_mini_transcription(),
				cost: '$0.18/hour',
			},
		],
	},
	Groq: {
		access: 'key',
		label: 'Groq',
		description: m.providers_lightning_fast_cloud_transcription(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		apiKeyConfigKey: 'providers.groq.apiKey',
		modelSettingKey: 'transcriptionGroqModel',
		endpointConfigKey: 'providers.groq.endpoint',
		modelsDoc: {
			label: 'Groq docs',
			href: 'https://console.groq.com/docs/speech-to-text',
		},
		defaultModel: 'whisper-large-v3-turbo',
		models: [
			{
				name: 'whisper-large-v3',
				description: m.providers_best_accuracy_10_3_wer_and_full(),
				cost: '$0.111/hour',
			},
			{
				name: 'whisper-large-v3-turbo',
				description: m.providers_fast_multilingual_model_with_good_accuracy(),
				cost: '$0.04/hour',
			},
		],
	},
	ElevenLabs: {
		access: 'key',
		label: 'ElevenLabs',
		description: m.providers_voice_ai_platform_with_transcription(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		apiKeyConfigKey: 'providers.elevenlabs.apiKey',
		endpointConfigKey: null,
		modelSettingKey: 'transcriptionElevenlabsModel',
		modelsDoc: {
			label: 'ElevenLabs docs',
			href: 'https://elevenlabs.io/docs/capabilities/speech-to-text',
		},
		defaultModel: 'scribe_v2',
		models: [
			{
				name: 'scribe_v2',
				description: m.providers_latest_flagship_transcription_model_with_97(),
				cost: '$0.40/hour',
			},
			{
				name: 'scribe_v1',
				description: m.providers_previous_generation_transcription_model(),
				cost: '$0.40/hour',
			},
			{
				name: 'scribe_v1_experimental',
				description: m.providers_experimental_version_of_scribe_with_latest(),
				cost: '$0.40/hour',
			},
		],
	},
	Deepgram: {
		access: 'key',
		label: 'Deepgram',
		description: m.providers_real_time_speech_recognition_api(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		apiKeyConfigKey: 'providers.deepgram.apiKey',
		endpointConfigKey: null,
		modelSettingKey: 'transcriptionDeepgramModel',
		modelsDoc: null,
		defaultModel: 'nova-3',
		models: [
			{
				name: 'nova-3',
				description: m.providers_deepgram_s_most_advanced_speech_to_text(),
				cost: '$0.0043/minute',
			},
			{
				name: 'nova-2',
				description: m.providers_deepgram_s_previous_best_speech_to_text(),
				cost: '$0.0043/minute',
			},
			{
				name: 'nova',
				description: m.providers_deepgram_nova_model_with_excellent_accuracy(),
				cost: '$0.0043/minute',
			},
			{
				name: 'enhanced',
				description: m.providers_enhanced_general_purpose_model_with_good(),
				cost: '$0.0025/minute',
			},
			{
				name: 'base',
				description: m.providers_base_model_for_standard_transcription_needs(),
				cost: '$0.0020/minute',
			},
		],
	},
	Mistral: {
		access: 'key',
		label: 'Mistral AI',
		description: m.providers_advanced_voxtral_speech_understanding(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		apiKeyConfigKey: 'providers.mistral.apiKey',
		endpointConfigKey: null,
		modelSettingKey: 'transcriptionMistralModel',
		modelsDoc: {
			label: 'Mistral docs',
			href: 'https://mistral.ai/news/voxtral/',
		},
		defaultModel: 'voxtral-mini-latest',
		models: [
			{
				name: 'voxtral-mini-latest',
				description: m.providers_api_optimized_voxtral_mini_model_delivering(),
				cost: '$0.12/hour',
			},
			{
				name: 'voxtral-small-latest',
				description: m.providers_voxtral_small_model_for_higher_accuracy_and(),
				cost: '$0.24/hour',
			},
		],
	},

	local: {
		access: 'onDevice',
		label: 'Local',
		description: m.providers_private_on_device_transcription_no_internet(),
	},

	speaches: {
		access: 'endpoint',
		label: 'Speaches',
		description: m.providers_self_hosted_transcription_server(),
		capabilities: { supportsPrompt: true, supportsLanguage: true },
		endpointConfigKey: 'providers.speaches.endpoint',
		modelIdConfigKey: 'providers.speaches.modelId',
	},
} as const satisfies Record<TranscriptionServiceId, TranscriptionProvider>;

/**
 * The ids of `key` providers (the ones that take a user API key), derived from
 * PROVIDERS. Consumed by the settings UI to type provider config fields.
 * (Transcription routing no longer keys off this: `operations/transcribe.ts`
 * dispatches over a single `UPLOAD_DISPATCH` table that excludes only the
 * on-device ids.)
 */
export type KeyProviderId = {
	[K in TranscriptionServiceId]: (typeof PROVIDERS)[K]['access'] extends 'key'
		? K
		: never;
}[TranscriptionServiceId];

/**
 * The ids of on-device providers, derived the same way. Today this is the
 * single local GGUF runtime; `isOnDeviceProviderId` is the one narrowing
 * boundary callers use before reading on-device-only fields like the selected
 * model's catalog id.
 */
export type OnDeviceProviderId = {
	[K in TranscriptionServiceId]: (typeof PROVIDERS)[K]['access'] extends 'onDevice'
		? K
		: never;
}[TranscriptionServiceId];

export function isOnDeviceProviderId(
	id: TranscriptionServiceId,
): id is OnDeviceProviderId {
	return PROVIDERS[id].access === 'onDevice';
}

/**
 * The upload providers: every non-on-device id, reached by uploading audio over the
 * wire (key, endpoint, session) rather than the on-device FFI path. "Upload" is
 * "not on-device", and on-device-ness is the one facet PROVIDERS declares, so the
 * subtraction reads as English. `UPLOAD_DISPATCH` is keyed by exactly this set.
 */
export type UploadProviderId = Exclude<
	TranscriptionServiceId,
	OnDeviceProviderId
>;
