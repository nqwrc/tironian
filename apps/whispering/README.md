<p align="center">
  <a href="../../docs/brand/tironian.md">
    <img width="160" src="../../docs/brand/icon/tironian-1024.png" alt="Tironian">
  </a>
  <h1 align="center">Tironian</h1>
  <p align="center">Dictation you own.</p>
</p>

Tironian is a free and open source dictation app for macOS and Windows. It
records speech, transcribes it with a model on your machine by default, cleans
the transcript up, and puts the text where your cursor is. No account, no server
holding the only copy, and no telemetry unless you switch it on.

Named after Marcus Tullius Tiro, who in 63 BC built the first Western shorthand
so a speech could be written at the speed it was spoken. The brand system,
including what the product may and may not claim today, is in
[docs/brand/tironian.md](../../docs/brand/tironian.md).

## Attribution

Tironian is a modified version of **Whispering**, part of the
[Epicenter](https://github.com/EpicenterHQ/epicenter) project, used under
AGPL-3.0. Forked at `3ef2103a72` on 2026-08-27. The upstream project does not
endorse this fork. See [NOTICE](../../NOTICE).

Internal identifiers, package names and import paths still read `whispering` and
`@epicenter/*` on purpose, so this fork can keep taking upstream fixes. The
reasoning is in the brand document under "Rename tiers".

## Hosting

The same browser-hostable Svelte SPA serves two hosts:

- The browser build, served as static assets.
- The Epicenter Tauri host, which runs it under `/apps/whispering`.

Tironian does not own a native shell. Epicenter owns the only Tauri runtime at
`apps/epicenter/src-tauri`.

## Host boundary

```text
apps/whispering/src
|-- browser condition --> apps/whispering/build --> Cloudflare static assets
`-- tauri condition ----> apps/epicenter/dist/whispering
                                      |
                                      `--> apps/epicenter/src-tauri
                                           native commands and windows
```

The browser is a real product target, not a desktop fallback. It owns browser recording, IndexedDB blobs, browser auth redirects, and web-safe shortcuts. The Epicenter build selects native implementations for system shortcuts, OS permissions, local model transcription, native windows, and app-data files.

Selection happens at build time through the `#platform/*` imports in `package.json`:

- The default condition resolves `*.browser.ts` implementations.
- The `tauri` condition resolves `*.tauri.ts` implementations.
- Shared code can use the nullable `tauri` capability namespace as a guard, but it does not choose implementations at runtime.

Epicenter's asset build sets `EPICENTER_HOST=1`, which activates the `tauri` module condition and the `/apps/whispering` asset base. No other build signal selects Whispering's native implementations.

## Run locally

Start apps from the repository root.

```bash
# Hosted browser app plus its local API
bun dev:whispering

# Browser UI only
bun dev:whispering:ui

# Epicenter desktop with Whispering as a native app window
bun dev:epicenter
```

The browser app runs on `http://localhost:1420`. Epicenter also opens Whispering at `epicenter://app/whispering`.

## Build and verify

```bash
# Browser artifact: apps/whispering/build
bun run --cwd apps/whispering build

# Epicenter assets, including apps/epicenter/dist/whispering
bun run --cwd apps/epicenter build

# Browser and Tauri type resolution
bun run --cwd apps/whispering typecheck

# App tests
bun test apps/whispering/tests
```

Run the two asset builds sequentially in one checkout. SvelteKit owns a shared `.svelte-kit` directory, so concurrent browser and Epicenter builds can race over generated configuration.

For the complete desktop artifact:

```bash
bun run --cwd apps/epicenter desktop:build
```

## Capability differences

| Capability | Browser | Epicenter desktop |
| --- | --- | --- |
| Microphone recording | Browser media APIs | Native recorder |
| Cloud and self-hosted transcription | Yes | Yes |
| On-device GGUF transcription | No | Yes |
| In-app shortcuts | Yes | Yes |
| System-global shortcuts | No | Yes |
| Paste at the active cursor | Clipboard fallback | Native delivery when permitted |
| Recording storage | IndexedDB | Epicenter app-data files |
| Floating recording overlay | In-page | Native auxiliary window |

## Data boundary

Tironian stores settings and recording metadata locally first. Audio leaves the device only when the selected transcription provider requires an upload. The browser and Epicenter builds can both use direct provider connections, the hosted Epicenter gateway, or a self-hosted endpoint. On-device transcription is available only through Epicenter because it depends on the native model runtime.

## There is no hosted browser deploy

`wrangler.jsonc` published the static SPA to `whispering.epicenter.so`. ADR-0227 refused that runtime: a browser tab is not a target, so the config and its deploy step are gone. Whatever Cloudflare last published keeps serving until somebody deletes the Worker, because removing the config stops republishing rather than taking anything down.

ADR-0227 says what would reopen this, which is trying-before-installing turning out to matter more than the capability seams cost.
