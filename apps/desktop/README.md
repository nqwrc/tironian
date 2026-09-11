# Tironian desktop host

Tironian ships one native application host. It owns one Tauri runtime and one native command API. The dictation SPA keeps its source in `apps/tironian`; this host builds and serves its desktop variant without copying that source into this folder.

```text
trusted SPA source                 Desktop build output

apps/tironian/src    -----------> dist/dictation
apps/desktop/ui       -----------> dist/home
                                          |
                                          v
                              Bun loopback sidecar
                                          |
                                          v
                              apps/desktop/src-tauri
```

A compiled application is a `dist/<id>` build this release declares, served
below `/apps/<id>/`. Dictation is the one. It keeps its independently
deployable browser build, and the variant the host serves is selected at
build time by the `tironian-host` resolve condition.

That condition does not decide where the data lives. Every build opens its own
local store, with no platform seam (ADR-0226, ADR-0227). The host serves
bundles and local blobs; it owns no credential path, no application data, and
constructs no database. What the condition still selects is the local blob
composition (`#platform/blobs`, `#platform/base-path`), because the host's
blob store reaches the host's own filesystem through the WebView, where a
browser build has none.

## Run locally

Start the desktop host from the repository root:

```bash
bun dev:desktop
```

### On Windows

`bun dev:desktop` alone does not build here. The native crate pulls
transcribe-cpp with the `vulkan` feature on Windows x64, and that build needs
four things an ordinary shell does not provide: the MSVC environment, the Ninja
generator, a short target directory, and a CMake policy floor for the Opus that
`audiopus_sys` vendors. Each missing one is a hard failure, and the errors point
at vendored C++ rather than at what is actually wrong.

`apps/desktop/scripts/windows-build-env.bat` supplies all four and then runs
the dev server. Run it from this directory:

```bat
scripts\windows-build-env.bat
```

It takes an optional command, so it also wraps anything else that has to compile
the crate:

```bat
scripts\windows-build-env.bat cargo build --manifest-path src-tauri\Cargo.toml
```

It finds Visual Studio through `vswhere`, so Build Tools, Community,
Professional and Enterprise all work, and it uses the Ninja that ships inside
that install. It picks a short `CARGO_TARGET_DIR` at the root of the repository's
drive, because the ggml-vulkan shader build otherwise runs past Windows'
250-character object-path limit; set `CARGO_TARGET_DIR` yourself to override
that, keeping it near a drive root. It needs `VULKAN_SDK` set, and warns when it
is not.

Tironian Home is the model administration window and nothing else:
the one place a local transcription model is chosen, downloaded, or deleted. A
single-app product has no launcher and no chat pane to hold beside it, so Home
renders Settings directly rather than switching between panes. Tironian, the
dictation SPA, hands transcription setup back to Home's Settings when the host
has no usable local model, and Settings offers the ordinary launch action once
there is one. The tray and deep links remain shortcuts into the same windows:

```bash
open 'tironian://app/dictation'
open 'tironian://app/home'
```

## Build and verify

```bash
# Build Home, the compiled application, and the Bun sidecar
bun run --cwd apps/desktop build:desktop

# Package the complete native application
bun run --cwd apps/desktop desktop:build

# Typecheck Home plus the compiled application's platform conditions
bun run --cwd apps/desktop typecheck

# Host, routing, sidecar, and window tests
bun test apps/desktop/scripts apps/desktop/src

# Native command and fixture tests
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Ownership rules

- `src-tauri` owns native commands, permissions, windows, deep links, and packaging.
- `src` owns the Bun host, trusted route catalog, static-asset containment, and the Home session.
- `dist` is generated. Never edit it or commit product source beneath it.
- The dictation SPA owns its UI and browser deployment from `apps/tironian`.
- A multi-host SPA selects implementations through build-time `#platform/*` conditions. Runtime checks guard optional capabilities; they do not choose which implementation was bundled.
- Do not create `apps/desktop/<app>` source copies. The build must consume the canonical app source directly.

The durable host and trust decision is recorded in ADR-0118.
