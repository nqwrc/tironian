<p align="center">
  <img width="160" src="docs/brand/icon/tironian-1024.png" alt="Tironian">
  <h1 align="center">Tironian</h1>
  <p align="center"><strong>Dictation you own.</strong></p>
</p>

Tironian is a dictation app for macOS and Windows. It records speech,
transcribes it with a model on your machine by default, cleans the transcript
up, and puts the text where your cursor is. It needs no account and sends no
telemetry unless you switch it on.

It is named after Marcus Tullius Tiro, who in 63 BC built a shorthand fast
enough to write a speech at the speed it was spoken. The mark is U+204A, the
Tironian *et*, the one sign of his system still in daily use.

## What it does today

- Local transcription is the default: whisper.cpp over a GGUF model on your
  machine, with no key and no network. Six cloud providers are available with
  your own key.
- A cleanup pass (Polish) is on by default.
- Snippets expand deterministically and never pass through a model.
- Voice commands, a recording pill, and settings that export and import.
- Transcripts live in a local CRDT store on your disk.

What the product may claim, and what is roadmap, is kept in
[docs/brand/tironian.md](docs/brand/tironian.md) under "What the brand is
allowed to claim today".

## Download

Builds come from the `Tironian desktop build` workflow: Windows x86_64 (`.msi`
and NSIS `.exe`) and macOS Apple Silicon (`.app`). Tagging `vX.Y.Z` collects
them into a draft release. Builds are not yet signed, so macOS asks you to
confirm on first open (right-click the app, then Open) and Windows SmartScreen
warns once.

## Build it

Requires [Bun](https://bun.sh) (the version pinned in `package.json`), Rust
stable, and CMake. On Windows, the Vulkan SDK as well.

```bash
bun install
bun dev:epicenter
```

That runs the desktop app in development. A release build is
`bun run --cwd apps/epicenter desktop:build`. CMake 4 needs
`CMAKE_POLICY_VERSION_MINIMUM=3.5` in the environment for the bundled ggml and
opus builds.

## Where things are

| Path | What it is |
| --- | --- |
| `apps/whispering` | The dictation app itself, a Svelte SPA. Its internal name is inherited from upstream. |
| `apps/epicenter/src-tauri` | The native desktop host that bundles and runs it: recorder, local transcription, tray, shortcuts. |
| `packages/data`, `packages/ui` | The local store and the component library the app is built on. |
| `docs/brand/` | Name, mark, palette, type, voice, and the claims ledger. |
| `apps/honeycrisp` | Notes app kept alongside the dictation app in the desktop host. |

Code keeps upstream's `whispering` and `@epicenter/*` identifiers so upstream
fixes can still be merged. The reasoning is in the brand document under
"Rename tiers".

## Attribution and license

Tironian is a modified version of Whispering, part of the
[Epicenter](https://github.com/EpicenterHQ/epicenter) project, forked at
`3ef2103a72` on 2026-08-27. The upstream project does not endorse it. See
[NOTICE](NOTICE).

The apps, including Tironian, are licensed under AGPL-3.0 ([LICENSE](LICENSE)).
Anyone who receives a build is entitled to its source. The embeddable toolkit
packages keep the MIT license upstream published them under.
