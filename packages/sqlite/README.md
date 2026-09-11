# `@tironian/sqlite`

`@tironian/sqlite` is the MIT contract for an embedded SQLite handle:
`run`, `all`, and a synchronous `transaction`, plus the value and row types
those agree on. It normalizes nothing else. It owns no application schema, no
synchronization state, and no storage lifecycle.

One adapter answers the contract today:

| Entry point | Engine | Consumer |
| --- | --- | --- |
| `./bun` | `bun:sqlite` | `@tironian/data`'s Bun store |

The browser store keeps its durable facts directly in IndexedDB and loads no
SQLite at all, so there is no browser adapter here; add one against this same
contract if a browser-side SQLite consumer earns it.

Schema and transaction invariants belong to the consuming package. The client
store lives in `@tironian/data`. An app that keeps a local copy of a
provider's data owns its own file lifecycle.
