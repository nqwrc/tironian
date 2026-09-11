import { createPersistedMap, defineEntry } from '@tironian/svelte';
import { type } from 'arktype';
import { extractErrorMessage } from 'wellcrafted/error';
import { createLogger } from 'wellcrafted/logger';
import { os } from '#platform/os';
import { BITRATES_KBPS, DEFAULT_BITRATE_KBPS } from '$lib/constants/audio';
import { report } from '$lib/report';
import { defaultGlobalBindings } from '$lib/utils/default-global-bindings';
import { m } from '../paraglide/messages';

const log = createLogger('tironian/device-config');

// ── Global shortcut binding shape ────────────────────────────────────────────

/**
 * Runtime shape of a stored global shortcut: the structured `KeyBinding` the
 * frontend resolves to a `tauri-plugin-global-shortcut` accelerator (physical-key
 * space). `modifiers` is strictly enumerated; `keys` is validated as strings
 * here. A binding that is not a registrable chord produces no accelerator and is
 * refused before it registers (ADR-0117), so a bad or unsupported gesture is
 * never registered.
 */
const globalBinding = type({
	modifiers: "('ctrl' | 'alt' | 'shift' | 'meta' | 'fn')[]",
	keys: 'string[]',
}).or('null');

// The global chords this build ships, bound to this device's OS. The table and
// the reasoning behind every chord live in `utils/default-global-bindings.ts`,
// which is pure so the contract test can run the real table against the
// reserved-chord policy instead of a restatement of it. Exported because
// `platform/system-shortcuts.tauri.ts` reads it too: reset writes these values
// back, and push tells a default apart from a chord the user picked.
export const DEFAULT_GLOBAL_BINDINGS = defaultGlobalBindings(os.isApple);

// ── Per-key definitions ──────────────────────────────────────────────────────

/**
 * The provider API keys: the device entries that are secrets. Grouped on their
 * own so the secret set has a single source of truth. {@link SECRET_KEYS} is
 * derived from these keys, and the secrets facade reads exactly this set
 * (ADR-0074). Adding a provider key here makes it a device entry and a vault
 * secret in one line; there is no second list to keep in step.
 */
const SECRET_DEFINITIONS = {
	'providers.openai.apiKey': defineEntry(type('string'), ''),
	'providers.anthropic.apiKey': defineEntry(type('string'), ''),
	'providers.groq.apiKey': defineEntry(type('string'), ''),
	'providers.google.apiKey': defineEntry(type('string'), ''),
	'providers.deepgram.apiKey': defineEntry(type('string'), ''),
	'providers.elevenlabs.apiKey': defineEntry(type('string'), ''),
	'providers.mistral.apiKey': defineEntry(type('string'), ''),
	'providers.openrouter.apiKey': defineEntry(type('string'), ''),
	'providers.custom.apiKey': defineEntry(type('string'), ''),
};

/**
 * Device-bound configuration definitions: secrets, hardware IDs, filesystem
 * paths, and global OS shortcuts that should NEVER sync across devices.
 *
 * Each key has its own schema and default value. Stored individually in
 * localStorage under the `tironian.device.{key}` prefix.
 */
const DEVICE_DEFINITIONS = {
	// ── Provider backends ─────────────────────────────────────────────
	// One record per network backend: how this device reaches it. API keys
	// are secrets (grouped above as `SECRET_DEFINITIONS`) and never sync.
	// Empty `endpoint` means the provider's official API; Custom and Speaches
	// have no official API, so their endpoints carry real defaults.
	...SECRET_DEFINITIONS,
	'providers.openai.endpoint': defineEntry(type('string'), ''),
	'providers.groq.endpoint': defineEntry(type('string'), ''),
	'providers.custom.endpoint': defineEntry(
		type('string'),
		'http://localhost:11434/v1',
	),
	'providers.speaches.endpoint': defineEntry(
		type('string'),
		'http://localhost:8000',
	),
	/**
	 * Model installed on the Speaches server. Device-local like the rest
	 * of the record: which models are pulled depends on the machine.
	 */
	'providers.speaches.modelId': defineEntry(
		type('string'),
		'Systran/faster-distil-whisper-small.en',
	),

	// ── Recording hardware ────────────────────────────────────────────
	'recording.cpal.deviceId': defineEntry(type('string | null'), null),
	'recording.navigator.deviceId': defineEntry(type('string | null'), null),
	'recording.navigator.bitrateKbps': defineEntry(
		type.enumerated(...BITRATES_KBPS),
		DEFAULT_BITRATE_KBPS,
	),

	// Local transcription model selection and unload policy are deliberately
	// absent: the host owns the one active local model and its lifecycle, and
	// Tironian Home administers both (ADR-0180). They are still device-local,
	// just owned a layer down, where the model files and the accelerator are.

	// ── Global OS shortcuts (device-specific, never synced) ───────────
	// Structured KeyBinding (physical-key space) resolved to a plugin accelerator.
	// Old accelerator-string values are not migrated: they fail this schema and
	// reset to the defaults (clean break, see the note below the singleton).
	'shortcuts.global.pushToTalk': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.pushToTalk,
	),
	'shortcuts.global.toggleManualRecording': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.toggleManualRecording,
	),
	'shortcuts.global.cancelRecording': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.cancelRecording,
	),
	'shortcuts.global.toggleVadRecording': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.toggleVadRecording,
	),
	'shortcuts.global.openRecipePicker': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.openRecipePicker,
	),
	'shortcuts.global.runRecipeOnClipboard': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.runRecipeOnClipboard,
	),
	// Always null: `openSettings` is focused-reach, so the router never routes a
	// write here. Present only to keep one global slot per command for the system
	// backend's uniform sync (see DEFAULT_GLOBAL_BINDINGS.openSettings).
	'shortcuts.global.openSettings': defineEntry(
		globalBinding,
		DEFAULT_GLOBAL_BINDINGS.openSettings,
	),
};

// ── Types ────────────────────────────────────────────────────────────────────

type DeviceConfigDefs = typeof DEVICE_DEFINITIONS;
export type DeviceConfigKey = keyof DeviceConfigDefs & string;

/**
 * The device entries that are secrets: provider API keys. The secrets facade
 * reads exactly this set (ADR-0074). Derived from {@link SECRET_DEFINITIONS},
 * so it stays complete by construction; there is no parallel list to maintain.
 */
export type SecretKey = keyof typeof SECRET_DEFINITIONS & string;
export const SECRET_KEYS = Object.keys(SECRET_DEFINITIONS) as SecretKey[];

// ── Singleton ────────────────────────────────────────────────────────────────

const DEVICE_CONFIG_PREFIX = 'tironian.device.';

export const deviceConfig = createPersistedMap({
	prefix: DEVICE_CONFIG_PREFIX,
	definitions: DEVICE_DEFINITIONS,
	onError: (key) => {
		log.info(`Invalid device config for "${key}", using default`);
	},
	onUpdateError: (_key, error) => {
		report.error({
			title: m.device_config_error_updating_device_config(),
			cause: {
				name: 'DeviceConfigUpdateFailed',
				message: extractErrorMessage(error),
			},
		});
	},
});

// Nothing here is migrated from a legacy format, and retired keys are orphaned
// rather than moved. Local model selections lived under
// `transcription.local.selectedModel` (and before that `transcription.*.modelPath`),
// and the unload policy under `transcription.localModelUnloadPolicy`; both are now
// host-owned (ADR-0180) and their old localStorage entries are simply ignored. The
// native recording rate also moved down to the host under ADR-0184, so the retired
// `recording.cpal.sampleRate` entry is ignored rather than migrated. The model
// files themselves are untouched in the shared Hugging Face cache, so recovery is
// one choice in Tironian Home rather than a re-download. Global shortcuts once
// stored accelerator strings under the same key: a legacy value fails the
// `globalBinding` schema on read and falls back to the default (see
// `createPersistedMap`). Either way upgrading users get the new defaults, and we
// carry no parser for a format nothing writes anymore.
