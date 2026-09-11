# status

state: active
remote: github-public
updated: 2026-09-11
stale-after-days: 30

## kpi
| kpi | target | current | as-of |
|---|---|---|---|

## focus
- Tironian, public at nqwrc/tironian. `main` starts at the upstream remote's `feature/tironian-rebrand` (2453555ef) with full history; every own branch was already inside it (the pre-rebrand feature branch is an ancestor; the three upstream slices are present in equivalent form). Not merged: 188 upstream-author branches, and upstream main (504 commits ahead, 42 conflicting files).
- macOS, desktop run 34549500550: smoke 4/4 (process alive, loopback host answers, "Tironian: Home" window on screen, no crash), dictation suite 327/0, `cargo test --release` 133/0. Before this repo no macOS bundle had ever shipped `apps-dist` and none could start: the CLI's tauri-utils 2.8.3 stops copying resources at the empty macOS `transcribe-libs`, now mapped on Windows only.
- Windows: same run green, installer audit included; the local NSIS installer carries `transcribe.dll`, the ggml-cpu backends and 234 `apps-dist` entries. Built, not runtime-tested, as requested.
- Code quality stays red on failures inherited from the fork (18 on the pre-rebrand feature branch, run 34218177933) plus a local-books test timeout. Every failure the rename caused is fixed.

## next
- Nicola's decisions: Apple Developer ID and Windows signing purchases; accent `#D97757`; KPIs and M0 evidence for this repo.
- Host TypeScript suite: 79/98 on macOS, 47/98 on Windows; the gap is Windows-only path and port handling.

## blockers
- The 13 Vivavoce artboards stay unreachable until `/design-login` runs once in an interactive `claude` terminal.
