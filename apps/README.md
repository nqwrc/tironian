# Apps

There is one runtime: a desktop SPA in a WebView, served by a Bun host over a
store the client owns (ADR-0227). The host serves bundles and local blobs; it
owns no application data and constructs no database (ADR-0226).
Hosted web as a second runtime with a host-owned replica is refused, and so are
third-party installed apps, for now.

Not every folder here is that: `epicenter` is the Tauri host, not a surface with
its own data. The rest of this page is about the surfaces that hold a person's
data.

## How a surface is put together

An application declares one inert data definition and opens its own store through it:

```txt
defineData({ id, title, kv, tables })
  pure JSON: no storage, no network, no framework

openDevice(definition)
  sqlite-wasm in the page, three durable relations in IndexedDB,
  one database per document (ADR-0261)

data.tables.notes.list()
  synchronous from here on
```

Opening the store is the only asynchronous thing the application does.
`data.tables.notes.list()` returns rows, not a promise, and
`data.tables.notes.subscribe(...)`
reports which rows a commit touched, for any local write (ADR-0221). Nothing
polls, and there is no generation counter to keep.

Every build opens its own local store, with no seam deciding where data lives
and no signed-in-account authority it replicates against.

The full contract for the store is in
[`packages/data/README.md`](../packages/data/README.md).

## Layout

The inert data definition is exported from the app's definition module, and
runtime composition sits beside it:

```txt
apps/<app>/
├── src/lib/workspace/index.ts   the data definition and its row types
├── src/lib/                     the store opener and app services
├── src/                         SvelteKit routes and components
└── package.json                 "exports": { ".": "./src/lib/workspace/index.ts" }
```

`whispering` uses that nesting. Follow the existing package shape.

Where a build genuinely differs, put the difference behind a `#platform/*`
build-time subpath import rather than a runtime branch. Whispering's
`#platform/blobs` resolves to `index.epicenter-host.ts` or `index.browser.ts`
under the `epicenter-host` and default conditions, because the host's blob
store reaches the host's own filesystem through the WebView and a browser
build has none.

## Adding an app

1. Write the data definition at `apps/<app>/src/lib/workspace/index.ts`: one
   `defineData({ id, kv, tables })` value plus its row types. Read the data
   rules first, especially that there are no optional fields or definition
   defaults.
2. Point `package.json` `exports["."]` at that file.
3. Add the store opener beside it.
4. Open the definition once where the app is acquired and pass the opened data
   handle to ordinary services. Do not spread it through the UI.
5. Add the app to `docs/licensing/licensing-strategy.md` and a `dev:<app>`
   script at the repo root.

## Where each surface stands

`whispering` is the surface built on the store: it declares a real workspace
with `defineData` (`src/lib/workspace/index.ts`) and opens the device store
(`src/lib/whispering/app.ts`), and its [README](whispering/README.md) is the
worked example. `epicenter` is the Tauri host, not a data surface; it
compiles, bundles, and serves the app.
