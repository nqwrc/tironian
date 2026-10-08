# ADR-0270: Learned dictionary terms live in their own tables

- Status: Accepted
- Date: 2026-10-07, revised and accepted 2026-10-08 after the privacy and
  correctness reviews
- Related: ADR-0271 (the field read that produces the terms)

## Context

The owner decided on 2026-10-08 to build learning from corrections: Windows
only, off by default, with the switch under Settings, Privacy & Processing.
Tironian reads only the field it just pasted into, a capped span, never
terminals or password managers, and a new term stays pending until the person
accepts it or the same correction shows up again. This record covers where
those terms live; ADR-0271 covers the read.

Learned terms must be visible, must not reach any prompt until they are
trusted, must be removable for good, and must never disturb the terms the
person typed.

The manual dictionary is one nullable tags value in the settings kv
(`apps/tironian/src/lib/workspace/index.ts:246`), written as a whole array by
the Dictation page (`routes/(app)/(config)/dictation/+page.svelte:76-90`). The
kv root is last-writer-wins per key (`workspace/index.ts:11-16`).

A table is permanent once shipped: `tableRoot` mints a Yjs root on first
access and a root can never be removed (`packages/data/src/store/document.ts:16-34`).
That makes this a storage-format decision, recorded before the plan proceeds.

Deleting a row does erase it. The document runs with `gc: true`
(`document.ts:13`), and the SPA's IndexedDB backing (`app/app.ts:2`) folds the
update log into one baseline once a document collects
`SNAPSHOT_FOLD_THRESHOLD` (64) appends (`packages/data/src/store/log.ts:28`,
`store/browser.ts:278-300`). A deleted row's content is gone from disk at the
next fold.

## Decision

1. Add a `learnedTerms` table to `tironianDefinition`
   (`workspace/index.ts:287-297`) with three fields:
   - `term: field.string()`: the corrected spelling, as the person typed it.
   - `status: field.select(['pending', 'active'])`.
   - `learnedAt: field.instant()`: when the row was created, reset when it
     becomes active.
2. Add a `forgottenTerms` table with one field, `hash: field.string()`: the
   lowercase hex SHA-256 of the folded term (NFD, combining marks removed,
   lowercased, whitespace collapsed).
3. No other column in either table. No recording id, no misrecognized form, no
   field text, no app id.
4. A new term starts `pending`. A pending term never enters any prompt. It
   becomes `active` when the person accepts it on the Dictation page, or when a
   later observation (a different dictation) produces the same fold again.
5. Forget, offered on every learned term in the Dictation page, writes the
   hash row first and then deletes the term row (`TableHandle.delete`,
   `packages/data/src/store/store.ts:313`). No plaintext of a forgotten term
   stays in the document after the next fold.
6. A hash in `forgottenTerms` blocks the same fold from being learned again.
   The hash keeps the plaintext out of the row, the UI and any export. It is
   not secrecy: someone holding the store can hash a word list and find a
   short word.
7. The manual dictionary kv value is never written by the learner.
8. The glossary sent to the recognizer, to Polish, and to Recipes is composed in
   one pure function: manual terms first and verbatim, then active learned terms
   with the newest first, minus any whose fold is already present. Pending terms
   are never part of it. Manual terms come first so that a recognizer prompt
   budget overflow drops learned terms before manual ones.
9. Neither table is part of settings bundles in this release. Bundles carry
   what the person authored (`app/settings-categories.ts:123-128`). The
   learning switch lives in its own preference category, `correctionLearning`,
   so importing the Dictionary category never turns field reading on. The
   import screen also leaves that category unchecked when a file carries it, so
   a shared file cannot switch reading on without a deliberate check.

## Alternatives rejected

- Append to the `dictionary` kv array: a background writer races the person's
  whole-array edits under LWW and can drop their terms.
- Use the `dictionary` kv value plus a "learned" marker list: two stores have to
  agree on undo, and the marker cannot tell a learned term from one the person
  later typed in by hand.
- Keep a `dismissed` status with the plaintext term: the rejected word stays in
  the document forever and no UI can remove it.
- Store the blocklist as a kv tags key: every kv key must sit in a bundle
  category (`settings-categories.test.ts:9-23`), and importing that category
  replaces the whole array, which would silently unblock terms forgotten on this
  machine.
- Activate a term on its first sighting: a style edit, a co-author's edit or a
  deliberate rename would reach every provider before the person saw it.

## Consequences

- The `tables:learnedTerms` and `tables:forgottenTerms` roots exist in every
  document from first use, even after the feature is removed.
- A new status value later needs a widened select. Rows written before the
  change still conform, because the old values stay valid.
- A forgotten term can be learned again only by typing it into the manual
  Dictionary, which the learner never blocks.
