# status

state: active
remote: github-public
updated: 2026-09-11
stale-after-days: 30

## kpi
| kpi | target | current | as-of |
|---|---|---|---|

## focus
- Tironian, a local-first dictation app for macOS and Windows, public at nqwrc/tironian. No upstream name remains in tracked files or paths outside the license allowlist: `bun run check:brand-residue` reports 0 (from 15216) and runs inside `check:structure`. What remains are the copyright lines, license texts and modified-version notices that AGPL-3.0 and MIT require.
- Scope: the dictation window (`apps/tironian`) and Model settings, served by the Tauri host (`apps/desktop`). Removed: sign-in, accounts, sync, hosted inference, the web deployment, the sibling notes app, the app catalog, the Home chat pane, and every app, package and document the product did not import. Identity: bundle `app.tironian`, loopback ports 41730/41731, scheme `tironian://`, sidecar `tironian-host`, crate `tironian`. Local transcription and bring-your-own-key providers remain.
- Verified at 4735c9804: desktop run 34613692147, macOS smoke 4/4 (dictation window "Tironian" on screen at launch), dictation suite 319/0, `cargo test --release` 129/0, host TypeScript suite 41/0; Windows build and installer audit green. Local Windows: typecheck 0 errors, all checks pass, `cargo test` 118, package tests 12 failures, all Windows-only and present in the baseline.

## next
- Nicola's decisions: Apple Developer ID and Windows code-signing purchases; accent `#D97757`; KPIs for this repo.
- `feature/home-brand-tokens`, PR #2 (the CSP `font-src` change kept by decision): Home loads the dictation window's brand layer, `apps/tironian/src/brand.css`, through the `@tironian/app/brand.css` export; built Home body computes `oklch(0.2 0.006 65)` (was shadcn navy `oklch(0.129 0.042 264.695)`). Home also takes the brand typefaces: the host CSP now admits `font-src 'self' data:`, and under the real host policy Instrument Sans and IBM Plex Mono load with 0 errored faces. Cost: Home's single-file build went from 729.81 kB to 1,168.61 kB, all subsets inlined. The sidecar end-to-end smoke fails on Windows with exit 143 after SIGTERM, identically with the change stashed.
- Follow-ups, not defects: ADR-number citations in comments name design records that no longer ship; the `packages/sqlite` browser adapter has no consumer; seven sound files have no recorded provenance; no generated third-party notices file ships with the installers.

## blockers
- The 13 Vivavoce artboards stay unreachable until `/design-login` runs once in an interactive `claude` terminal.
