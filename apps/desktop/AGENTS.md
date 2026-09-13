# Tironian desktop host

One desktop application host. Bun serves the trusted dictation SPA; Rust owns
native application mechanisms.

Design: a compiled application is a declared `dist/<id>` build; a build no longer declares a host-owned replica at all, so `tironian-host` does not mean that. One application window, `dictation` (ADR-0245): the product never opens a second window for a surface. One closed list of compiled applications the host declares and Rust's built-in app table mirrors; nothing external is admitted. One host-owned active local transcription model, administered from the dictation app's Settings. Owner-scoped local stores. One trusted application origin. Remote devices attach to the session, never to per-app endpoints.

## Shape

- `src/applications.ts` declares the compiled applications the host serves, in one `{ id, title }` shape. There is no admitted catalog: a single-app product admits no other apps, and `COMPILED_APPLICATIONS` is the whole list (dictation alone). Do not reintroduce a second, discovered source of application IDs.
- There is one window, and it is the dictation app. Settings, including the local model administration, live inside it (ADR-0245). Do not add a second window for any surface: no Home, no launcher, no separate settings or model window, no in-app application switcher. The recording overlay pill is the one other webview, because it shows recording state over other applications; it is not a surface a person opens.
- There is no launch verb. The tray, deep links, macOS reopen, and startup all reveal the one dictation window. Do not reintroduce `launch_application`, `open_home`, or an `app-` window class.
- A compiled application is exactly a `dist/<id>` build `COMPILED_APPLICATIONS` declares. `loadStaticAssets` loads every one and the server serves each below `/apps/<id>/` through the shared contained resolver, so adding one is a list entry plus a build script, never another asset field, resolver, or route handler. A declared application that did not build refuses the boot. Its document is held in memory, gated behind a browser session, and hashed into the one CSP. Serving an app's document straight off disk skips those, and the app boots blank because the browser refuses its own start script.
- There is no host-owned replica, and a build cannot reach one. Every build opens its own local store. The `tironian-host` resolve condition survives for exactly one thing: the host's local blob store reaches the host's own filesystem through the WebView, where a browser build has none, so `#platform/blobs` and `#platform/base-path` select the desktop composition under it. Never detect the host at runtime, never widen `tauri` to mean it, and never reintroduce a storage seam behind it.
- An application window gets a capability file only when it calls a native command. Same-origin HTTP to the Bun host needs no grant; the trusted-app capability is the dictation app's own authority, not a compiled application's default.
- `src/main.ts` resolves the one Tironian data root by calling `tironianDataRoot()` from `@tironian/constants/app-data`, and derives `blobs/` below it. There is no `data/`: the store that lived there was a host-owned plane that got refused. Rust does not pass a root in, and no other TypeScript may compute one: a host and a CLI that disagree here write to two different mailboxes. The one native resolution left, `src-tauri/src/app_data.rs`, exists because the staged-recording blob store runs before the host could have told it anything, and it is pinned equal to the TypeScript one by a test.
- Every trusted app owns one directory under that root, `apps/<app-id>`, named by the bare label the host issues it (`dictation`). Allocation is nominal: the host issues the id and creates nothing, and it reclaims nothing when an app leaves. There is no reserved-id list because there is nothing else to reserve against: every id this host issues names one of its own compiled applications. Do not give a webview a path into any of it: reach is undecided, and the handle has no filesystem in it.
- Local sources remain host-owned and are never remote routes or capabilities.

## Refusals (do not reopen without a new ADR)

- No daemon `mount.ts` as the composition model; the mount path is CLI/projection for one app.
- No MCP for first-party in-process apps; MCP stays the boxed-app airlock (ADR-0081).
- No loose in-process TypeScript tool modules in v1; future scripting starts from an out-of-process runner unless a new ADR explicitly accepts unsafe developer-mode host imports.
- No bundled Tauri SPA plus side IPC; Bun serves the SPA and the API from one loopback origin.
- The host serves only the compiled `dist/<id>` builds that `COMPILED_APPLICATIONS` declares (dictation alone), and never installs dependencies, runs a build system, or reads application source. There is no boundary that admits a folder from a publisher URL, a self-hosted builder, a local developer build, or offline media, because none of those sources exist for this product.
- No registry, publisher identity, artifact signing, or update mechanism, and nothing to design one for: the release ships the whole closed list.
- No per-app permission, capability grant, or device prompt. An app window runs as the host: shared origin and session, OS-granted browser device access, and the one app-window native API. Do not describe the capability file as a sandbox.
- A transcription request never names a model. The one active model changes only through the explicit administration commands in Settings; `TranscriptionHints` stays model-free (ADR-0245).
- No second window, no global rail, no chat surface, no raw-data view, and no installation, update, or removal UI. Re-adding a data-reading pane means first deciding how a reader becomes a replica of somebody else's authority, which is a design decision, not a component.
- The loopback server always binds `127.0.0.1` and rejects every request without the per-launch token; this ships with the first server version, not later (ADR-0084).
- No HTTP command route, Tauri IPC command path, stdio command protocol, generic synced command table, or transport-adapter framework until a real second consumer earns it. There is no session WebSocket today; the native command API is the architecture.
