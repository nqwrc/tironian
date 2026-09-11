# Query Layer

This directory is Tironian's Svelte/TanStack observation layer. It adds
query identity, mutation lifecycle state, and cache invalidation around the
UI-free `TironianApp` and platform services.

One `TironianUiSession` creates one `QueryClient` and one
`TironianQueries` namespace. The fulfilled boot provider supplies both to
the ready descendant tree. There is no module-global client.

```text
Svelte component
  -> TironianQueries
  -> TironianApp / operations / services
```

## Ownership

- `client.ts` creates the session-owned QueryClient and Wellcrafted factories.
- `audio.ts` owns recording-audio availability query identity.
- `download.ts` adapts the shared download mutation.
- `transcription.ts` adapts shared transcription mutation identity.
- `index.ts` composes those adapters for one ready app.

App workflows stay in `$lib/operations` or on
`TironianApp`. Query modules do not become a second product API.
Browser and Bun scripts use the app directly and do not depend on
TanStack or Svelte.

Components obtain the namespace during initialization:

```ts
const queries = getTironianQueries();
```

Shared definitions expose `.options` for `createQuery` and `createMutation`.
One-component Result operations should use `resultQueryOptions` or
`resultMutationOptions` locally instead of growing this directory.

The name is deliberately `queries`, not `rpc`: this code does not cross a
process boundary. Tironian's published actions own genuine cross-process
automation.
