# Licensing Strategy

**Status:** Active
**Date:** 2026-04-28
**Owner:** Braden Wong
<!-- doc-path-check: ignore-next-line -->
**Promoted from:** `specs/20260428T120000-licensing-strategy.md` (spec deleted in PR #2248)

## Summary

The whole model in one line: **run our apps freely (AGPL-3.0, which only blocks taking our work, closing it, and reselling it), build on our toolkit freely (MIT, build and own anything).**

Tironian uses two active license tiers, split by how you use the code rather than by package type: code you *run* (both apps) is AGPL-3.0, and code you *build with* (the embeddable toolkit: `data`, `ui`, `sqlite`, and their internal utilities) is MIT to maximize developer adoption. A third proprietary tier is documented as an escape hatch but deferred indefinitely, and stays empty unless a specific paying customer requires it. There is no Contributor License Agreement; we do not dual-license.

This fork carries no hosted cloud or self-host deployable, so the `server` library and the packages that existed only to compose it (`packages/server`, `packages/matter-core`, `packages/skills`) were pruned along with `apps/api` and `apps/self-host`. The tier reasoning below still governs what remains, and the split-by-use-not-by-type rule is unchanged.

This document is the canonical reference and the human-readable registry behind `bun run check:licenses`. That script walks dependency manifests only, so it cannot see the roster below: when a package is added, removed, or relicensed, this table has to be edited by hand or it goes stale silently. The root [LICENSE](../../LICENSE) is the legal dispatch. This spec is the technical reasoning, threat model, and decision procedure for new packages.

## Operating principle

Two rules classify every package, not one.

1. **Product decision (roots):** is this a package we actively offer third-party developers to embed in their own software? If yes, it is a toolkit root and it is MIT. This is the only judgment call; everything else follows mechanically.
2. **Mechanical rule (closure):** whatever a root's workspace dependency closure touches must also be MIT, or the root itself could not legally stay MIT. A package can be swept into MIT by rule 2 alone even though nobody embeds it standalone. `@tironian/identity` is that case: no third party embeds `identity` on its own, but it sits inside the dependency closure of the MIT toolkit roots, so rule 2 forces it to MIT regardless.

A package that is neither a chosen root nor inside a root's closure is something we ship as a product, and it is AGPL-3.0. This is safe because the toolkit is not our competitive moat; the moat is the apps and the AGPL copyleft itself, which blocks a closed-source or hosted rebrand, so giving the toolkit away permissively costs us nothing and buys adoption.

To the two audiences it reads as two promises:

- **Run our apps freely** (all apps). These are AGPL-3.0. Running is not distribution, so for someone running the apps locally AGPL never triggers; they can run, read, and modify their own copy with no obligation. What AGPL blocks is taking our work, closing it, and shipping it to others: a closed-source rebrand (blocked by GPL conveyance copyleft) or a network-served modified fork that hides its source (blocked by AGPL §13). This costs an honest user nothing.
- **Build on our toolkit freely** (`data`, `ui`, `sqlite`, and the MIT-clean contracts they carry). These are MIT. For a library, "use" means shipping it inside your own software, which is the whole point; AGPL would force every app built on the toolkit to also be AGPL, blocking the primary use and killing adoption. So: build anything on the toolkit, including closed-source and commercial products, and own what you build.

Note that "does it run" is not the discriminator, because all code runs; "is it offered for you to embed" is. Internal glue like `packages/client` is a library the apps build with, yet it is AGPL, because it composes provider HTTP wiring for the apps, not a toolkit we offer third parties. That is the case the embed test sorts correctly and a naive "library means permissive" rule would get wrong.

These tiers cannot collapse to one license. "Free to use" is compatible with AGPL for the apps and fundamentally incompatible with it for a ship-inside library; a single license would either mislead builders or restrict people running the apps for no gain. MIT on the toolkit is load-bearing, not a legacy concession. (LGPL is the theoretical middle for a copyleft-but-linkable library. It would protect only improvements to the toolkit's own internals, which are not our moat, while adding real friction: its relink obligation is ill-defined for tree-shaken JS bundles, and many corporate legal teams blanket-ban the GPL family. MIT is strictly cleaner here.)

This also stays sustainable for a single maintainer. AGPL on the products is operationally cheap: no proprietary build pipelines, no commercial license sales process, no enterprise plugin gating, no CLA bot. MIT on the toolkit adds only one dependency-closure guard (`bun run check:licenses`), which fails if any MIT package can reach an AGPL one. That guard reads `package.json` dependency edges and nothing else: it cannot see AGPL source *copied* into an MIT package, and it cannot see this document.

The proprietary tier is preserved as an option for one specific situation: a paying customer requires a specific feature that AGPL self-hosting would otherwise give away free. It will not be populated speculatively. An empty proprietary tier is the correct end-state unless that situation arises.

The consumer app (Tironian) is AGPL for the same reason as everything else we ship, and the protection is real, not cosmetic. Running one locally never triggers §13, so AGPL there reduces to GPL conveyance copyleft, which is exactly what stops a competitor from forking a shipped app (the wedge app most of all) into a closed-source rebrand. That block, not "brand consistency," is the load-bearing reason the apps are AGPL, and it preserves every freedom the local-first ethos cares about: users can always read, run, modify, and fork what they run.

## Threat model

The motivating concern is direct code copying by competitors. This is not theoretical: there is a steady drumbeat of stories in the local-first and developer-tools space of one team taking another team's open source code, rebranding it, and shipping it as a competing product, sometimes hosted, sometimes embedded inside a closed-source app.

We sort this into four scenarios:

| # | Scenario | MIT outcome | AGPL outcome | Proprietary outcome |
|---|---|---|---|---|
| 1 | An individual runs Tironian locally for personal use | Allowed | Allowed (no §13 trigger when running locally) | Forbidden |
| 2 | A developer forks a Tironian library to build their own app | Allowed | Their app must also be AGPL (kills adoption) | Forbidden |
| 3 | A company forks the Tironian app and ships it under a new brand, closed-source | **Allowed** | Forbidden (must publish source) | Forbidden |
| 4 | A company forks the Tironian app and runs a modified copy as a network-served hosted product | **Allowed** | Forbidden (§13 forces publishing source of the running version) | Forbidden |

Scenarios 3 and 4 are the threat. AGPL handles both. We default to AGPL rather than proprietary for these scenarios because AGPL preserves the right to read and fork the code (consistent with the local-first ethos), still forces a hosted fork to publish its (modified) source via §13, and avoids the operational overhead of running a proprietary tier.

Scenario 4 is the one where the network clause is load-bearing, because a hosted fork never distributes a binary and so a plain GPL conveyance trigger would never fire; §13 closes that gap. On a locally-run app AGPL reduces to GPL conveyance copyleft, which is exactly what blocks scenario 3, a competitor forking a shipped app into a closed-source rebrand. Brand, distribution, and update cadence remain the real moats for end-user apps; the license is the backstop that keeps a fork from being closed.

## Three-tier split

### Tier 1: MIT

**Applies to:** exactly five packages, which is what `bun run check:licenses` reports. The embeddable toolkit libraries `packages/data`, `packages/ui`, and `packages/sqlite`, plus the toolkit-internal packages they carry: `packages/field` and `packages/identity`.

**Rationale:**
- Libraries: we want developers to embed `@tironian/data` in their own projects with zero friction. AGPL would forbid that for closed-source consumers, killing adoption. The library is not what we sell.
- Toolkit-internal packages (`field`, `identity`): these are dependencies bundled into the MIT toolkit libraries, so they must be MIT-compatible for the toolkit to stay distributable as MIT. `@tironian/identity` owns the identity and principal vocabulary the toolkit needs for row ownership. It is not separately marketed.
- MIT-clean closure: the toolkit depends on no AGPL package. `PrincipalId` and `AuthState` live in `@tironian/identity`. `bun run check:licenses` enforces this, on dependency edges only.

### Tier 2: AGPL-3.0

**Applies to:** everything else. Both apps (`apps/tironian`, `apps/desktop`), and the internal packages `packages/blobs`, `packages/svelte-utils`, `packages/constants`, `packages/client`, `packages/recorder`, `packages/vite-config`.

**Rationale:**
- Consumer app: on a locally-run app AGPL reduces to GPL conveyance copyleft, which is exactly what blocks a competitor from forking a shipped app into a closed-source rebrand (scenario 3). That is real protection, not brand consistency. The toolkit libraries are the only MIT surface.
- Internal packages (`blobs`, `svelte-utils`, `constants`, `client`, `recorder`, `vite-config`): private glue that composes the apps; never offered for third-party embedding, so AGPL with no adoption cost.

### Tier 3: Proprietary (deferred)

**Applies to:** none today, and none planned.

**Rationale:** Documented as an escape hatch for one specific situation: a real paying customer requires one specific feature that AGPL self-hosting would otherwise give away free. The tier will not be populated speculatively. The empty-tier end-state is the goal.

**Convention if ever used:**
- Live in their own subdirectory, e.g. `apps/<name>/proprietary/` or a dedicated `enterprise/` top-level directory.
- `LICENSE` file in that directory contains an "all rights reserved" notice (template in this spec).
- `package.json` uses `"license": "SEE LICENSE IN LICENSE"`.
- Listed explicitly in the root `LICENSE` dispatch under a "Proprietary" section.
- Code is publicly visible on GitHub (for transparency and customer trust) but no rights are granted to use, copy, modify, or redistribute.
- Scoped to the smallest unit that solves the customer's problem. Do not gate adjacent features speculatively.

This is the same pattern Bitwarden uses for `bitwarden_license/` and Sentry uses for `getsentry/getsentry`. We treat it as a graduation path, not a default.

## The self-host story, which is settled

Upstream once planned an `apps/sync-server` split to give homelabbers something self-hostable without the cloud platform, and answered it with one shared library (`packages/server`) and two deployables that composed it: a hosted personal cloud and a self-hosted single-partition instance. Both were AGPL, so the split was architectural rather than licensing.

This fork carries neither deployable: `apps/api`, `apps/self-host`, and `packages/server` were pruned because nothing in the kept apps imports them. The tier reasoning that governed them is recorded above in case a hosted or self-hosted deployable returns.

## Deferred MIT carve-out candidates

The boundary currently errs toward AGPL: some toolkit-shaped code is AGPL only because it is bundled with, or has not yet been separated from, AGPL code. None of these are live defects, because every consumer today is one of our own AGPL apps, and an AGPL app depending on an AGPL package is fine. So each is recorded here with the trigger that would move it, rather than executed now. The rule is the same as for new packages: refuse the carve-out until a third-party embedder actually exists.

| Candidate | Today | Would become | Trigger to execute |
|---|---|---|---|
| `@tironian/svelte` main barrel (`fromDisposableCache`, `createPersistedState`, `createPersistedMap`) | AGPL | MIT | A third party embeds the MIT `@tironian/data` in a Svelte app, or we publish the toolkit for external use. It got smaller rather than closer: the store's synchronous reads deleted the adapters (`fromTable`, `fromKv`) that were the barrel's reason to exist, and the sign-in and chat-pane code it once carried are both gone, so ask whether the remainder is worth a package before splitting it. |
| `@tironian/client` | AGPL | MIT | We decide to offer a public client SDK. Its dependency closure is already MIT-clean; only the product decision is pending. |

Recording these keeps the "nothing moves today" answer honest: the design is not frozen, it just has no live producer for any of these seams yet.

## Per-package breakdown

All apps are AGPL-3.0. MIT is reserved for the embeddable toolkit libraries.

| Path | License | Notes |
|---|---|---|
| `apps/tironian` | AGPL-3.0 | The dictation SPA |
| `apps/desktop` | AGPL-3.0 | Desktop host: serves bundles and local blobs |
| `packages/data` | MIT | The store: one document per application, its SQLite log and projection (toolkit) |
| `packages/ui` | MIT | shadcn-svelte components (toolkit) |
| `packages/sqlite` | MIT | Domain-free synchronous SQLite adapter contract shared across embedded runtimes (toolkit) |
| `packages/field` | MIT | Field schema kinds (toolkit-internal) |
| `packages/identity` | MIT | Identity and principal vocabulary the toolkit needs for row ownership (toolkit-internal) |
| `packages/blobs` | AGPL-3.0 | Content-addressed blob store |
| `packages/svelte-utils` (`@tironian/svelte`) | AGPL-3.0 | Svelte 5 reactive helpers |
| `packages/constants` | AGPL-3.0 | Shared constants |
| `packages/client` | AGPL-3.0 | Transcription and completion HTTP client |
| `packages/recorder` | AGPL-3.0 | Audio recording |
| `packages/vite-config` | AGPL-3.0 | Shared Vite config |

> **MIT-clean closure:** the MIT toolkit's entire dependency closure is MIT. `@tironian/data` imports from no AGPL package: shared capability state lives in `@tironian/identity`. `bun run check:licenses` walks every package's dependency closure and fails if an MIT package can reach an AGPL one. It reports the same five packages this table marks MIT; if the two disagree, one of them is wrong and the script is not the one that can be edited into agreement.

## Decision procedure for new packages

When adding a new package or app, ask in order:

1. **Is this meant for third-party developers to embed in their own software (or a contract/utility bundled into something that is)?** → MIT. No further questions. Confirm its dependency closure is MIT-compatible (`bun run check:licenses`), or document the AGPL deps.
2. **Is this an app (desktop surface, CLI, hosted service) that Tironian ships?** → AGPL-3.0. Running it locally never triggers §13, so AGPL there reduces to GPL conveyance copyleft, which blocks a closed-source rebrand of a shipped app. That block is the reason, not brand consistency.
3. **Is this internal/glue infrastructure (constants, client) that composes the product rather than being offered for third-party embedding?** → AGPL-3.0.
4. **Is there a real paying customer asking for one specific feature that AGPL would let them self-host for free?** → Proprietary, scoped to that feature, in its own subdirectory. Otherwise → AGPL. Never gate speculatively. The proprietary tier is reactive, not prospective.

When the embed test is unclear, default to AGPL and record the possible MIT carve-out with its trigger. An accidental MIT release of server/app value is the worse mistake because that version stays permissive forever; an AGPL internal package can still move to MIT when a real third-party embedder appears and the dependency closure is clean. If external contributors have already touched the AGPL code, get their consent before moving it to MIT.

## Contributor licensing posture

**No CLA. No DCO. No dual-licensing.**

Reasoning:
- We do not sell commercial AGPL exemptions to enterprises.
- Cal.com, dub.sh, Plausible, and most other open-core projects we are modeled on do not require CLAs either. The friction discourages contributors and provides no benefit here.
- If we ever needed to relicense an AGPL app away from AGPL (e.g. to sell it without copyleft), we would need either (a) a CLA from the start, or (b) consent from every external contributor at that point. We accept (b) as a future cost in exchange for present-day contributor friendliness. As of this spec, there are zero external contributors to AGPL components, so the cost is zero today.
- If a meaningful external PR lands on an AGPL component and we anticipate ever wanting to dual-license, we can add CLA Assistant (a GitHub bot, click-through CLA) at that point. We do not pre-commit to that decision.

By contributing to Tironian, contributors agree their contributions are licensed under the same license as the file they are modifying. This is the standard "inbound = outbound" convention used by Linux, Rails, and most open source projects without formal CLAs.

## Prior art

Two clusters of prior art are relevant. Our reasoning follows the first cluster (no proprietary tier) and keeps the second cluster as a graduation path should a specific paying-customer situation ever force it.

**Closest models (no proprietary tier):**
- **Plausible Analytics:** AGPL throughout, single-founder-led for years, monetizes via hosted SaaS only. No proprietary, no CLA.
- **PostHog:** Apache and AGPL components, monetizes via hosted SaaS and enterprise SLA contracts on the same code. No proprietary tier in the standard sense.
- **Cal.com:** AGPL throughout, hosted SaaS, no CLA.
- **dub.sh:** AGPL throughout, hosted SaaS, no CLA.
- **Yjs:** MIT for the core library and client-side providers (`y-websocket`, `y-webrtc`, `y-indexeddb`); AGPL for `y-redis` (server-side scaling backend).

**Graduation models (proprietary tier alongside open core, only if needed):**
- **Liveblocks:** Apache-2.0 for client libraries; AGPL for server.
- **Bitwarden:** GPL/AGPL for clients and core server; proprietary for `bitwarden_license/` enterprise modules.
- **Sentry:** Migrated through several variants (MIT to BSL to FSL); historically used a `getsentry/getsentry` proprietary repo for paid features.

Our default model is closest to Plausible and PostHog: permissive for libraries, AGPL for apps, proprietary tier exists on paper but stays empty. We graduate toward the Bitwarden/Sentry pattern only if a specific paying customer pulls a specific feature into the proprietary tier.

## Proprietary LICENSE template

When the first proprietary module is added, use this text:

```
Copyright (c) 2023-2026 Braden Wong. All rights reserved.

This software and associated documentation files (the "Software") are
proprietary and confidential. The Software is made available on GitHub
for transparency and customer trust, but no license is granted to use,
copy, modify, merge, publish, distribute, sublicense, or sell copies of
the Software except as expressly permitted in writing by the copyright
holder or as required to view the source on GitHub.

For commercial licensing, contact: github@bradenwong.com

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

## Open questions and review triggers

- Revisit if a meaningful external contributor lands a PR on `apps/api`, `apps/self-host`, or `packages/server`. Decide then whether to add CLA Assistant.
- Revisit if a specific paying customer requires a feature that AGPL would let them self-host for free. This is the trigger to populate the proprietary tier (one feature, scoped to a subdirectory). Until that happens, the tier stays empty by design.
- Revisit if we sell self-hosted enterprise licenses. That would be the trigger for moving to a real dual-license posture (and retroactively adding CLAs).
