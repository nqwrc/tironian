# status

state: active
remote: github-public
updated: 2026-09-11
stale-after-days: 30

## kpi
| kpi | target | current | as-of |
|---|---|---|---|

## focus
- Tironian, public at nqwrc/tironian. `main` starts at nqwrc/epicenter `feature/tironian-rebrand` (2453555ef) with full history; every own branch was already inside it (`whispering-snippets` is an ancestor; the three upstream slices are present in equivalent form). Not merged: 188 upstream-author branches, and upstream main (504 commits ahead, 42 conflicting files).
- macOS: the first smoke run found that no macOS bundle of this host had ever shipped `apps-dist`, so the app could not start. The CLI 2.10.1 embeds tauri-utils 2.8.3, which stops copying resources at the empty macOS `transcribe-libs`; that mapping is now Windows-only. Run 34546392445: 4/4 smoke checks pass, and the Home and dictation windows render. The macOS dictation suite showed a `mock.module` ordering leak (324/1), reproduced on Windows and fixed.
- Windows: CI build and installer audit green; the local NSIS installer carries `transcribe.dll`, the ggml-cpu backends and 234 `apps-dist` entries. Built, not runtime-tested, as requested.

## next
- Confirm on the next desktop run: macOS dictation suite and `cargo test --release`; Code quality down to the inherited failures (the rebrand's stale title assertion is fixed).
- Nicola's decisions: the bundle identifier `so.epicenter` and port 39130 are shared with an installed Epicenter (same data folder; Tironian cannot start while Epicenter runs); sign-in and sync go to api.epicenter.so; Apple Developer ID and Windows signing purchases; accent `#D97757`; Honeycrisp still listed in Home; KPIs and M0 evidence for this repo.

## blockers
- The 13 Vivavoce artboards stay unreachable until `/design-login` runs once in an interactive `claude` terminal.
