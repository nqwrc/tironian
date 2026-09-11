/**
 * `@tironian/client`: typed HTTP helpers for bring-your-own-key transcription
 * and completion providers.
 *
 * Every surface here takes a caller-built connection (base URL, API key,
 * fetch); this package owns no auth state, no identity, and no deployment of
 * its own. It talks to whatever OpenAI-compatible or provider-specific HTTP
 * endpoint the caller resolved, never a hosted Tironian server.
 */

export type { EngineFetch } from './agent-engine.js';
export { CompleteError, complete } from './complete.js';
export {
	CONNECTION_PRESETS,
	type Connection,
	type ConnectionPreset,
	ListModelsError,
	listModels,
	type PresetId,
	type ResolvedConnection,
	resolveConnection,
} from './connection.js';
export { TranscribeError, transcribe } from './transcribe.js';
