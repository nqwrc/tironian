# @tironian/constants

Shared Tironian platform contracts: the facts several packages and apps must agree on but none can own, so they live below all of them. Each runtime context gets its own subpath export, so bundlers only pull in what they need.

This is a floor, not a junk drawer. A fact belongs here only when more than one package (or app) needs it and no single one is its natural owner. Single-owner values live beside their owner instead.

## Exports

### `@tironian/constants/apps`

The app dev-port and, where an app still has one, canonical production-URL registry (`APPS`). Tironian ships no hosted deployment of its own, so `APPS.TIRONIAN` carries only the dev port `workspaceAppViteConfig` binds to.

```typescript
import { APPS } from '@tironian/constants/apps';
```

### `@tironian/constants/app-data`

Where Tironian stores things on a machine: the application-data root and the naming grammar below it. Pure functions over strings; no store, handle, or lifecycle.

### `@tironian/constants/ai-providers`

The sellable-model catalog (`AI_MODELS`) and its derivations (`AiProvider`, `MODELS_BY_ID`, `providerLabel`, `toHostedCatalog`).

### `@tironian/constants/provider-credentials`

Third-party provider credential resolution (ADR-0105): one pure resolver plus the `ProviderCredentialSpec` type and an `.env.example` formatter.

## Adding a new app

1. Add an entry to `APPS` in `src/apps.ts` with `port` (and `url`, if it has a hosted deployment).
2. Every consumer picks it up automatically: TypeScript enforces completeness.
