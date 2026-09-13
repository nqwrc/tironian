# status

state: active
remote: github-public
updated: 2026-09-13
stale-after-days: 30

## kpi
| kpi | target | current | as-of |
|---|---|---|---|

## focus
- Tironian, a local-first dictation app for macOS and Windows, public at nqwrc/tironian. No upstream name remains in tracked files or paths outside the license allowlist: `bun run check:brand-residue` reports 0 (from 15216) and runs inside `check:structure`. What remains are the copyright lines, license texts and modified-version notices that AGPL-3.0 and MIT require.
- Scope: the dictation window (`apps/tironian`), the only window, served by the Tauri host (`apps/desktop`). Removed: sign-in, accounts, sync, hosted inference, the web deployment, the sibling notes app, the app catalog, the Home chat pane, and every app, package and document the product did not import. Identity: bundle `app.tironian`, loopback ports 41730/41731, scheme `tironian://`, sidecar `tironian-host`, crate `tironian`. Local transcription and bring-your-own-key providers remain.
- Verified at 4735c9804: desktop run 34613692147, macOS smoke 4/4 (dictation window "Tironian" on screen at launch), dictation suite 319/0, `cargo test --release` 129/0, host TypeScript suite 41/0; Windows build and installer audit green. Local Windows: typecheck 0 errors, all checks pass, `cargo test` 118, package tests 12 failures, all Windows-only and present in the baseline.

## next
- Nicola's decisions: Apple Developer ID and Windows code-signing purchases; accent `#D97757`; KPIs for this repo.
- `feature/single-window` (ADR-0245): the Home window is gone. Model settings live in the dictation app under Settings, Privacy & Processing; the dictation window holds the model administration grants, the tray has no Model settings item, `tironian://app/home` is refused, and `font-src data:` is removed (the dictation build serves 28 woff2 files, 0 `data:` fonts). Checks: `cargo test` 116/0, dictation suite 320/0, host 37 pass with 2 environmental failures (Windows SIGTERM exit 143 as on main; compiled-host test cannot bind 41730 while the installed app runs). Rendered in the real Tironian Dev WebView over CDP: Settings, Privacy & Processing lists the three models with live download state and the unload policy, fonts load without `data:`, and the console holds only the Ctrl+Alt+Space conflict. The model store reads the host when the panel mounts, not at import. Installed locally 2026-09-13 (installer exit 0); the installed app's Settings shows Whisper Small active. PR: nqwrc/tironian#3.
- Vivavoce design, deliverable 4 (project "App redesign directions" on Claude Design, 10 screens): deliverable 2 tokens already ship in `brand.css`. Not implemented yet: labeled sidebar with live stats, Home 4b, Registrazioni rows 4c, six-tab Settings 4d/4j, Dettatura 4f (Polish, commands, dictionary), Ricette 4g, Snippet 4h, detail modal 4i, light onboarding 4e, pill states 4a. Not carried over, per docs/brand/tironian.md: the vivavoce wordmark, the soundwave mark, Italian as source language.
- Follow-ups, not defects: ADR-number citations in comments name design records that no longer ship; the `packages/sqlite` browser adapter has no consumer; seven sound files have no recorded provenance; no generated third-party notices file ships with the installers.

## blockers
- Tironian Dev and the installed app share the data root `%APPDATA%\app.tironian`, so a dev launch sweeps production's `.staging/rust` (seen 2026-09-13, nothing was in flight). Do not run the two side by side while dictating until the sweep or the root is scoped.
