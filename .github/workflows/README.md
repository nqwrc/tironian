# CI/CD workflows

All workflows live flat in `.github/workflows/`. Period-delimited prefixes group
them when sorted: `desktop` for the app build, `ci.{name}` for repo-wide checks.

## Workflows

| File | Trigger | What it does |
|---|---|---|
| `desktop.yml` | Pull requests, push to `main`, `v*` tags, manual | Builds Tironian on Windows x86_64 (`.msi`, NSIS `.exe`) and macOS Apple Silicon (ad-hoc-signed `.app`). Audits the Windows installers for the transcribe-cpp runtime DLLs. Smoke-tests the macOS app and runs the dictation app and Rust host suites there. On a `v*` tag, collects the installers into a draft GitHub Release. |
| `ci.format.yml` | Push to `main`, pull requests | The merge gate: `lint:ci`, `typecheck`, `test`, `check:structure`. `bun run check` is the same gate locally. |

## The macOS test

The smoke step in `desktop.yml` passes only when all four checks hold:

1. The bundled executable is still running 45 seconds after launch.
2. The loopback host answers HTTP on `127.0.0.1:41730`.
3. At least one on-screen window is owned by the app.
4. No crash report for it appeared while it ran.

A runner has no microphone grant and no downloaded model, so no dictation round
trip is attempted. Screenshots, the window list, stdout and the app's logs are
uploaded as the `smoke-macos-aarch64` artifact whatever the verdict.

## Releases

Pushing a tag `vX.Y.Z` builds both platforms and creates a draft release with
the installers attached. Nothing is public until someone opens the draft and
publishes it. The version in the file names comes from `version` in
`apps/desktop/src-tauri/tauri.conf.json`, so bump it before tagging.

Builds are unsigned. macOS asks for confirmation on first open (right-click,
Open) and Windows SmartScreen warns once. Signing needs an Apple Developer ID
with notarization and a Windows Authenticode certificate, each a purchase with
its own secrets.

## Removed at the fork

Upstream's Cloudflare deploys, release automation, autofix, sponsors README and
Gmail drift check need upstream secrets or services and were removed when this
repository started. Git history has them.
