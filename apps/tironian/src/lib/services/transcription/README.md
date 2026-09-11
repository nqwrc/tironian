# Transcription Services

Most providers have no service file here at all. OpenAI, Groq, a Speaches box you
run yourself and the Tironian gateway all speak the same OpenAI wire, so they are
connections rather than code paths: `$lib/operations/transcribe.ts` resolves a
transport and hands it to the shared `transcribe()` in `@tironian/client`
(ADR-0060). Self-hosting is one of those connections, pointed at your own base URL,
which is why there is no `self-hosted` directory beside `cloud`.

**`/cloud`**: the three providers that do not speak that wire and keep their own
client. Deepgram takes a raw body under `Authorization: Token`, ElevenLabs an
`xi-api-key` with `model_id`, and Mistral goes through its own SDK. ADR-0060
blesses the exception.

**The `local` provider** has no JS transcription service, and no model of its own. Rust owns the GGUF model catalog, capabilities, download, shared-HF-cache resolution, and transcribe.cpp inference (`src-tauri/src/transcription/`), and the host owns the one **active** local model that every ordinary local transcription runs on (ADR-0180). Tironian chooses the route and sends advisory hints only: `transcribe_recording` takes a blob id and a `TranscriptionHints` with no model name, and answers with the exact model that produced the text. Dispatch is inlined in `$lib/operations/transcribe.ts`. Model administration (which model is active, download, delete, unload policy) lives in Tironian Home; Tironian reads only `get_active_model`, projected by the `$lib/state/active-local-model.svelte.ts` store, so it can name the active model in a readiness blocker.
