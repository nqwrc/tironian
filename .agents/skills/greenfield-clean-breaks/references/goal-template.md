# Goal Template

A `/goal` that invokes this skill should stay short. The skill carries the
compatibility-refusal and clean-break review; the goal carries only what varies
per pass.

## Minimal Template

```txt
/goal Run a greenfield clean-break pass on <target>.

  Load skill: greenfield-clean-breaks.
  Target: <path or concept>
  Compatibility stance: <assume no users | preserve public API | ask before public breaks>
  Stop condition: <proposal only | N approved checkpoints | churn threshold>
  Starting target: <narrowest file, package, or boundary>

  Begin.
```

## Worked Examples

### Proposal-Only Pass

```txt
/goal Run a greenfield clean-break pass on Tironian's app/workspace boundary.

  Load skill: greenfield-clean-breaks.
  Target: apps/tironian/src/lib/workspace/index.ts, apps/tironian/src/lib/app/app.ts
  Compatibility stance: assume no users except durable workspace/storage shapes.
  Stop condition: proposal only; report before/after shape and wait for OK before editing.
  Starting target: apps/tironian/src/lib/workspace/index.ts

  Begin.
```

### Implementation Pass

```txt
/goal Run a greenfield clean-break pass on the desktop host's boot boundary.

  Load skill: greenfield-clean-breaks.
  Target: apps/desktop/src/main.ts and apps/desktop/src-tauri/src/lib.rs
  Compatibility stance: assume no users; preserve only the documented data-root layout.
  Stop condition: 4 approved checkpoints or when remaining findings need product input.
  Starting target: apps/desktop/src/main.ts

  Begin.
```

### Broader Boundary Pass

```txt
/goal Run a greenfield clean-break pass on the store's persistence boundary.

  Load skill: greenfield-clean-breaks.
  Target: packages/data/src/store and packages/data/src/projection
  Compatibility stance: ask before public API, sync wire format, or persisted data shape changes.
  Stop condition: three consecutive inspected files produce no actionable findings.
  Starting target: packages/data/src/store

  Begin.
```

## What Does Not Belong In The Goal

The skill already owns:

- The product-sentence rule
- The ownership pass
- The compatibility contract list
- The greenfield smell catalog
- The clean-break mechanics
- The finding format
- The earned-trigger test

If a future goal needs more ritual than this, update the skill or a reference
file instead of copying the ritual into the goal.
