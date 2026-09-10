# status

state: active
remote: github-private
updated: 2026-09-11
stale-after-days: 30

## kpi
| kpi | target | current | as-of |
|---|---|---|---|

## focus
- Tironian, the dictation app, as its own repository. `main` starts at nqwrc/epicenter `feature/tironian-rebrand` (2453555ef) with full history. Every own branch was already inside it, checked in code rather than by merge base: `whispering-snippets` is an ancestor; the three upstream slices are present in equivalent form (`RunEvent::Reopen` is cfg-gated, `sync_file` opens a write handle, the CPU fallback and data-root diffs reverse-apply). The 188 other fork branches are upstream authors' experiments and were not merged. Upstream main (504 commits ahead, 42 conflicting files, mostly the store's rewritten data vocabulary) was not merged either.
- Productized: bundle, installers, window titles, tray, host errors and the Home UI read Tironian, version 0.1.0; U+204A icon rendered from `docs/brand/icon/`; the six workflows that need upstream secrets are removed; `desktop.yml` builds Windows and macOS, smoke-tests the macOS app, and drafts a release on `v*` tags.
- Verified on Windows: Whispering suite 327 pass, host `cargo test --lib` 122 pass, `build:desktop` succeeds. `bun.lock` was stale under the pinned bun 1.3.3 and is regenerated with it. Host TypeScript suite 47/98 pass, identical on the untouched start commit, so not caused here.

## next
- Read the first `desktop.yml` run: the macOS smoke verdict (four checks) and whether the host TypeScript failures are Windows-only.
- Decisions that are Nicola's: KPIs for this repo; bundle identifier `so.epicenter` (it names the data root); `HOSTED_AUTH_ORIGIN` still points at api.epicenter.so, so sign-in and sync use upstream's service; Apple Developer ID and Windows code-signing purchases; making the repo public before any build is distributed (AGPL).

## blockers
- The 13 Vivavoce artboards stay unreachable until `/design-login` runs once in an interactive `claude` terminal.
