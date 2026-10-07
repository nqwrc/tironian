# Tironian

Local-first dictation app. Monorepo with a Svelte SPA and a Tauri desktop host.

## Structure

```
apps/
  tironian   the dictation SPA, and the reference for how the product is
             built
  desktop    Tauri host for the trusted app window
packages/
  data       the store, data definitions, openers, sync, and projection
  ui         shadcn-svelte components
```

## Runtime

One runtime: a desktop SPA in a WebView over a client-owned store. The host serves bundles and brokers credentials and owns no application data.

This is a single-app dictation product with no Home chat pane, no `packages/chat` and no app-shell agent chat. `apps/tironian` declares a real workspace with `defineData` (`src/lib/workspace/index.ts:283`) and opens its one device document through `openDevice`, composing settings, recordings, recipes, snippets, and app rules over it (`src/lib/app/app.ts`); there is no account store and no sync attach.

This fork has no hosted cloud or self-host deployable: there is no `apps/api`, `apps/self-host`, `packages/server` or `ops/`.

## License boundary

Apps are AGPL. The embeddable toolkit packages are MIT.

Moving or copying code from an AGPL package into an MIT one is a relicensing act. `bun run check:licenses` guards dependency edges only and cannot see copied source. Decision procedure: `docs/licensing/licensing-strategy.md`.

## Always use bun

Prefer `bun` over npm, yarn, pnpm, and node. Use `bun run`, `bun test`, `bun install`, and `bun x` (instead of npx).

## Local dev

Start apps from the repo root with `bun dev:<app>`. Do not cd into an app to start it.

- `bun dev:<app>` runs every process the app needs.
- `bun dev:<app>:ui` is the frontend alone, where that split exists.
- Details in the `monorepo` skill.

## Git hygiene

Stage specific files only. Never use `git add .` or `git add -A`.

Do not include AI or tool attribution in commits.

## Destructive actions need approval

Force pushes, hard resets (`--hard`), branch deletions.

## External grounding

When external library behavior affects correctness, verify against DeepWiki, official docs, or local installed types before changing code.

Skip this for stable basics and repo-local patterns already documented in skills.

## Library logging

Do not use direct `console.*` in library code. Use `wellcrafted/logger`, except in CLIs, tests, and benchmarks.

## Coherent edits

Do not default to the smallest local patch.

Before changing code, prose, or agent instructions, identify the largest relevant unit whose shape controls the problem, then reconsider that unit as if the new context had always been known. The correct result may still be a small diff, but minimizing the diff is not the goal.

## Agent instruction files

`AGENTS.md` is the canonical shared instructions file.

- `CLAUDE.md` files are compatibility shims for Claude Code. They should only import a sibling `AGENTS.md` with `@AGENTS.md`, plus rare Claude-specific notes.
- Add a nested `AGENTS.md` only for a local constraint that must apply to every edit beneath it. Never use one as an index or README substitute; subsystem orientation belongs in that subsystem's README.
- When adding a nested `AGENTS.md`, add a sibling `CLAUDE.md` shim.
- Do not create orphan `CLAUDE.md` files.

## Planning docs and decisions

`docs/adr/`, `docs/CONTEXT` (create either lazily, only when the first decision or term needs one), package READMEs, tests, and current code are evidence, not automatic instructions. Start with the user's request and the current implementation.

**ADRs.** They describe decisions that were reasonable at the time, but may be stale, scoped to a different problem, or intentionally reopened. Check status, amendments, and actual code before relying on one.

- If the requested design conflicts with an ADR, do not stop automatically. Explain the conflict, then either follow the current evidence or amend/delete the ADR when the new decision is durable.
- Ask the user when the choice materially depends on product or architectural judgment that cannot be recovered from the repository, rather than silently inheriting an old decision.
- Do not cite an ADR merely because it exists. State whether it is a hard constraint, useful context, or a decision being reconsidered.

**Specs.** In-flight design scaffolding, not current truth. This holds for every `specs/` directory, top-level and per-app or per-package.

- Two states only: `Draft` and `In Progress`. "Done" is deletion, not a terminal status, so a spec still in the tree declaring `Implemented`/`Superseded` is a hygiene smell (`scripts/check-doc-hygiene.ts` flags it).
- When a design pass settles a durable decision, record it as an ADR under `docs/adr/` and delete the now-spent spec. Git keeps the body recoverable.

Treat conflicts among specs, ADRs, code, tests, and user intent as judgment points, not automatic precedence rules.

## Writing conventions

Audience decides vocabulary: what a person reads uses the word they already have, and what a developer reads uses the word that is most accurate, which is often technical and load-bearing.

| A person reads | A developer reads |
| --- | --- |
| UI copy, errors shown to them, deep links, README front doors | types, functions, library error messages |

- Do not soften `authority`, `replica`, `projection`, or `principal` in code to sound friendlier, and do not let one of them reach a person.
- A library states a failure precisely; the app decides what a person is told about it.
- Keep user-facing text direct and concrete.

**Punctuation.** Avoid en dash characters (`U+2013`). Prefer colon, comma, semicolon, or sentence break over em dash characters (`U+2014`), especially in UI strings, docs, comments, JSDoc, and commit messages.

**Explaining Tironian work.** Lead with a useful recommendation or outcome, carry implementation complexity the agent can safely handle, and surface only the reasoning and details that materially affect the user's judgment, action, safety, or review. Necessary difficulty is fine; incidental complexity is not.

**Generated prose.** Applies to everything the agent writes unless a more specific skill owns the destination.

- Use plain words: "is" over "serves as" or "stands as", and the specific claim over praise or puffery.
- State the point directly. No "not just X, but Y", no forced groups of three, no vague attributions like "experts believe".
- Prefer the concrete word over the abstract metaphor: substrate, wedge, vector, nexus, flywheel, north star. Load-bearing repo vocabulary is exempt: `primitive` as in the Item primitive, API `surface`, `harness`, `authority`, `replica`, `projection`, `principal`.
- Say what the thing does, not how it feels. If a sentence could appear unchanged in another project's docs, cut it.
- One idea per sentence. Active voice: name the actor ("the compiler validates queries", not "queries are validated").
- Cut adverbs and hedging; use the stronger verb or the number. "In order to" is "To"; "utilize" and "leverage" are "use".
- Formatting tells: sentence-case headings, no decorative emoji, no bold-label-colon bullets that restate the line.

Load `writing-voice` for substantial prose or explicit tone/rewrite work.

## Review posture

Be direct about flawed assumptions, weak designs, and regressions. Do not agree just to be agreeable.

## Agent collaboration

Codex and Claude Code are both full executors. The agent the user starts a session with owns that session's work: it gathers the evidence, decides, edits the active worktree, tests, commits, and integrates the result.

Two agents never edit the same branch at once. Before editing, read `STATUS.md` and `git log --all` for work another agent left in flight, and work on your own `feature/*` or `bugfix/*` branch. Record what you leave in flight in `STATUS.md`, so the next session, of either agent, can pick it up.

A consultation is a separate mode, used only when the user asks one agent to research or review for the other. Do not start one automatically because a task is complex. From a Codex session, the `consult-claude` skill runs Claude against a sealed snapshot of the checkout and owns the isolation, follow-ups, and checkpoints; the requesting agent decides which feedback is valid, re-verifies it against live state, and applies it.

## Review routing

Keep procedures in skills; keep `AGENTS.md` to routing.

| When | Load |
| --- | --- |
| substantial implementations, public API changes, refactors, multi-file changes, or a request to challenge, simplify, clean up, greenfield, or make a clean break | `post-implementation-review`, before final handoff or staging |
| continuous indirection-reduction work | `collapse-pass` directly |
| during review: ownership, lifecycle, API, package-boundary, clean-break, compatibility-refusal, or asymmetric-win decisions | escalate to `greenfield-clean-breaks` |
