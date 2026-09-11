# Never-Touch and Pause List

Codebase-specific facts that the collapse pass must respect. These strings, shapes, and packages outlive any individual session; changing them silently breaks on-disk data or downstream consumers.

## Durable strings: never change without explicit product decision

These appear in on-disk paths or schemas another module validates against. They are part of the durable vocabulary of Tironian.

### IndexedDB database name

```
"tironian/{definitionId}/device"
```

The durable address of one browser document (`packages/data/src/store/browser.ts`), holding the three relations that have to survive a reload: `updates`, `outbox`, and `cursor`. It reads as ownership (ADR-0261, amending ADR-0233): the application, then the device document. A definition id is dot-separated lowercase labels, so it holds no `/`: the segment after `tironian/` is always exactly the application, and no address can be read as another one. Changing the shape detaches every existing store from its consumer, and what is lost is not the work (the authority still owes it to the device) but the guarantee that a reload sees it.

`tironian-store-{definitionId}` and `tironian-store-{definitionId}#{private,database}` are the superseded shapes, from before an application had a dedicated device document. They are deletion targets at every open, never read.

### Public arktype schemas

Other modules import and rely on these by name and shape. Renaming a field or changing a brand silently invalidates their callers.

- `PrincipalId`, `INSTANCE_PRINCIPAL_ID` (`packages/identity/src/identity.ts`)

### Root names inside a document

An application is one `Y.Doc` whose roots are `tables:{name}` and `kv` (`packages/data/src/store/document.ts`). `Doc.get` is `setIfUndefined`, so it mints on miss, and a root can never be removed: renaming one strands every row under the old name permanently.

A row's document roots (`db.notes.create({...}, { document: ['body'] })`) are named by the application and allocated with the row. Renaming one orphans the prose written into it.

## Pause and ask before

The collapse pass should stop and surface to the user (not silently proceed) when about to:

- Change any string from the list above
- Delete a public exported name that has zero in-repo callers but plausible external consumers (the published MIT packages, `@tironian/data` and `@tironian/field`, are the load-bearing example: they emit to `dist` for toolchains we do not control)
- Collapse two files where one's JSDoc documents a non-obvious invariant (the JSDoc is the documentation of a contract; losing it loses the contract)
- Merge packages or move exports across package boundaries
- Change a function signature that crosses a published package boundary
- Collapse a `defineErrors` factory call to an inline `{ name, message, ...fields }` object, even for a single-variant log-only error. The factory call is the idiomatic shape; see `define-errors`, `error-handling`, and `logging` skills. Single-variant `defineErrors` is fine: the variant tag carries idiom consistency, forward-compat, self-documenting call sites, and a centralized message template that prevents drift across multiple log sites.

## Scope tiers

Default collapse-pass targets, narrowest to widest:

1. `packages/data`
2. `packages/svelte-utils`
3. `apps/tironian`
4. `apps/desktop`

Out of scope without an explicit pass declaration:

- `specs/`, `docs/articles/`, migration history (`*-legacy-*.md`, archived decision docs)
