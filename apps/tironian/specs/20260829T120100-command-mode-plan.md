# Command Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status**: Draft

**Goal:** Two spoken phrases, "scratch that" and "stop listening", run an action
instead of being transcribed into the user's text.

**Architecture:** A pure matcher runs on the raw transcript between
transcription and Polish. A match plus an applicability check branches the
pipeline out before Polish, snippet expansion, the completion sound, and
delivery. "Scratch that" undoes the previous delivery by sending backspaces
through a new host command; "stop listening" tears down a live VAD session.

**Tech Stack:** TypeScript, Svelte 5 runes, `bun test` with `mock.module`, Rust
with `enigo` behind `tauri-specta` bindings.

**Spec:** `apps/whispering/specs/20260829T120000-command-mode.md`

## Global constraints

- Package manager is `bun`. Never `npm`, `yarn`, `pnpm`, or `npx`.
- Run every command from the repo root. Do not `cd` into an app.
- Stage specific files. Never `git add .` or `git add -A`.
- Conventional commits. No AI or tool attribution in commit messages.
- No direct `console.*` in library code. Use `wellcrafted/logger`.
- No em dash (`U+2014`) or en dash (`U+2013`) in code, comments, JSDoc, UI copy,
  or commit messages. Use a colon, comma, semicolon, or a sentence break.
- Backspace cap: **2000**, the same number Snippets uses for replacement length.
- The setting key is `commandModeEnabled`, default **`false`**.
- Command ids are exactly `'scratchThat'` and `'stopListening'`.

Tests for the Whispering app: `bun run --filter '@epicenter/whispering' test`
Typecheck: `bun run --filter '@epicenter/whispering' typecheck`

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/whispering/src/lib/operations/match-command.ts` | Pure: normalize an utterance, return a command id or null |
| `apps/whispering/src/lib/operations/run-voice-command.ts` | Applicability against live state, and the effect dispatch |
| `apps/whispering/src/lib/state/last-delivery.svelte.ts` | Holds the one undoable delivery, session-scoped |
| `apps/whispering/src/lib/operations/pipeline.ts` | One branch after transcription, one write after delivery |
| `apps/whispering/src/lib/operations/sink.ts` | Exports `SinkKind` |
| `apps/whispering/src/lib/operations/delivery-reach.ts` | `DeliveryOutcome` gains `sinkKind` |
| `apps/whispering/src/lib/operations/delivery.ts` | Returns the sink kind it chose |
| `apps/whispering/src/lib/services/text/*` | `simulateBackspaces` on the service contract |
| `apps/epicenter/src-tauri/src/delivery.rs` | The `simulate_backspaces` host command |
| `apps/whispering/src/lib/workspace/index.ts`, `whispering/app.ts` | The `commandModeEnabled` field and its default |
| `apps/whispering/src/routes/(app)/(config)/settings/dictation/+page.svelte` | The toggle and the phrase list |

Task order is dependency order. Tasks 1, 2 and 3 are independent of each other
and could be done in any order; 4 needs 3, and 6 needs everything.

---

### Task 1: The matcher

**Files:**
- Create: `apps/whispering/src/lib/operations/match-command.ts`
- Test: `apps/whispering/src/lib/operations/match-command.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type VoiceCommandId = 'scratchThat' | 'stopListening'` and
  `matchCommand(text: string): VoiceCommandId | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/whispering/src/lib/operations/match-command.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { matchCommand } from './match-command';

test('matches the bare phrase', () => {
	expect(matchCommand('scratch that')).toBe('scratchThat');
	expect(matchCommand('undo that')).toBe('scratchThat');
	expect(matchCommand('stop listening')).toBe('stopListening');
});

test('absorbs what transcription adds around the phrase', () => {
	// A full stop is what Whisper appends to almost every utterance.
	expect(matchCommand('Scratch that.')).toBe('scratchThat');
	expect(matchCommand('  scratch that  ')).toBe('scratchThat');
	expect(matchCommand('scratch that!')).toBe('scratchThat');
	expect(matchCommand('...scratch that...')).toBe('scratchThat');
	expect(matchCommand('SCRATCH  THAT')).toBe('scratchThat');
	expect(matchCommand('scratch\nthat')).toBe('scratchThat');
});

test('internal punctuation is not stripped, so it must match the table', () => {
	expect(matchCommand('scratch, that')).toBeNull();
});

test('a phrase inside a sentence is content, not a command', () => {
	expect(matchCommand('scratch that idea')).toBeNull();
	expect(matchCommand('please stop listening')).toBeNull();
	expect(matchCommand('I told him to scratch that')).toBeNull();
});

test('empty and punctuation-only input match nothing', () => {
	expect(matchCommand('')).toBeNull();
	expect(matchCommand('   ')).toBeNull();
	expect(matchCommand('...')).toBeNull();
});

test('an inherited object key is not a command', () => {
	expect(matchCommand('constructor')).toBeNull();
	expect(matchCommand('toString')).toBeNull();
	expect(matchCommand('__proto__')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun run --filter '@epicenter/whispering' test match-command
```

Expected: FAIL, "Cannot find module './match-command'".

- [ ] **Step 3: Write the implementation**

Create `apps/whispering/src/lib/operations/match-command.ts`:

```ts
/**
 * Command Mode matching: a pure, total classification of one utterance.
 *
 * Whole-utterance equality, not substring search. A phrase inside a sentence is
 * content, because mid-stream matching has unbounded false positives with no
 * boundary rule that fixes them ("he said scratch that idea and moved on").
 *
 * Runs before Polish, which is the opposite of Snippets. Polish would reword
 * "scratch that" into prose, so a matcher downstream of it would only ever see
 * the phrase destroyed. Its failure mode is a phrase that does not match, which
 * delivers as ordinary text: visible and recoverable.
 *
 * See `specs/20260829T120000-command-mode.md`.
 */

export type VoiceCommandId = 'scratchThat' | 'stopListening';

/**
 * The spoken phrases, already in normalized form. Fixed in code rather than
 * user data: snippets are the user's content, commands are app behavior.
 *
 * A Map, not an object literal. An object literal inherits from
 * `Object.prototype`, so looking up "constructor" would return a function and
 * the `?? null` below would never fire, handing back something that is not a
 * command id at all.
 */
const PHRASES = new Map<string, VoiceCommandId>([
	['scratch that', 'scratchThat'],
	['undo that', 'scratchThat'],
	['stop listening', 'stopListening'],
]);

/** Punctuation and symbols, stripped from the ends of an utterance only. */
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * Reduce an utterance to the form the table is written in.
 *
 * Order matters. Edge punctuation is stripped after trimming so " scratch
 * that. " reaches the table, and internal punctuation survives, so
 * "scratch, that" stays unmatched rather than silently becoming a command.
 */
function normalize(text: string): string {
	return text
		.trim()
		.replace(EDGE_PUNCTUATION, '')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLowerCase();
}

/** The command this utterance is, or null when it is ordinary text. */
export function matchCommand(text: string): VoiceCommandId | null {
	const normalized = normalize(text);
	if (normalized === '') return null;
	return PHRASES.get(normalized) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun run --filter '@epicenter/whispering' test match-command
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/whispering/src/lib/operations/match-command.ts apps/whispering/src/lib/operations/match-command.test.ts
git commit -m "feat(whispering): add the command mode phrase matcher"
```

---

### Task 2: The backspace host command

This task crosses into `apps/epicenter/src-tauri`, a different app from
everything else in the plan. It has no `bun test` coverage: the Rust side is
verified by `cargo test` (which also regenerates the TypeScript bindings), and
the keystroke itself is verified by hand in Task 7.

**Load the `tauri` skill before starting this task.** `apps/whispering/AGENTS.md`
requires it for any change to Tauri commands, permissions, capabilities, or
generated bindings, which is all four of the things this task does.

`src/lib/tauri/commands.ts` needs no edit: it spreads the whole generated
`commands` object through `WrapAll`, so `simulateBackspaces` appears there as
soon as the bindings regenerate.

**Files:**
- Modify: `apps/epicenter/src-tauri/src/delivery.rs`
- Modify: `apps/epicenter/src-tauri/src/command_names.rs`
- Modify: `apps/epicenter/src-tauri/src/lib.rs`
- Modify: `apps/epicenter/src-tauri/capabilities/trusted-whispering-native-development.json`
- Modify: `apps/epicenter/src-tauri/capabilities/trusted-whispering-native-production.json`
- Regenerated (BOTH, `tauri_specta` writes the whole API to each and the crate's
  `generated_bindings_cover_every_declared_command` test asserts every command
  appears in both): `apps/whispering/src/lib/tauri/bindings.gen.ts` and
  `apps/epicenter/src/ui/bindings.gen.ts`
- Modify: `apps/whispering/src/lib/services/text/types.ts`
- Modify: `apps/whispering/src/lib/services/text/index.tauri.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `services.text.simulateBackspaces(count: number): Promise<Result<void, TextError>>`.

- [ ] **Step 1: Add the Rust command**

In `apps/epicenter/src-tauri/src/delivery.rs`, after `simulate_enter_keystroke`:

```rust
/// The most backspaces one undo may send.
///
/// Matches the Snippets replacement cap. Without it a five-minute dictation
/// would fire thousands of synthetic keystrokes into whatever holds focus, and
/// a partial delete is worse than a refusal: nobody can tell how far it got.
const MAX_BACKSPACES: u32 = 2000;

/// Simulates pressing Backspace `count` times.
///
/// One press deletes one grapheme cluster, so the caller counts graphemes, not
/// UTF-16 code units. Refuses above the cap rather than deleting part of it.
#[tauri::command]
#[specta::specta]
pub async fn simulate_backspaces(count: u32) -> Result<(), String> {
    if count > MAX_BACKSPACES {
        return Err(format!(
            "Refusing to send {count} backspaces: the limit is {MAX_BACKSPACES}."
        ));
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    for _ in 0..count {
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|error| format!("Failed to simulate Backspace: {error}"))?;
    }
    Ok(())
}
```

- [ ] **Step 2: Register the command name**

In `apps/epicenter/src-tauri/src/command_names.rs`, add to `COMMANDS`
immediately after `"simulate_copy_keystroke"`:

```rust
    "simulate_backspaces",
```

- [ ] **Step 3: Add it to the specta builder**

In `apps/epicenter/src-tauri/src/lib.rs`, extend the existing import on the
`use delivery::{...}` line to include `simulate_backspaces`, then add it to
`collect_commands![` immediately after `simulate_copy_keystroke,`:

```rust
            simulate_backspaces,
```

- [ ] **Step 4: Grant it to the Whispering window**

In both `apps/epicenter/src-tauri/capabilities/trusted-whispering-native-development.json`
and `...-production.json`, add to `"permissions"` immediately after
`"allow-simulate-copy-keystroke"`:

```json
		"allow-simulate-backspaces",
```

- [ ] **Step 5: Run the Rust tests to regenerate bindings and check the wiring**

```bash
cargo test --manifest-path apps/epicenter/src-tauri/Cargo.toml
```

Expected: PASS. The crate's tests check the capability files and the generated
bindings against `COMMANDS`, so a missing permission or a missing
`collect_commands!` entry fails here. `apps/whispering/src/lib/tauri/bindings.gen.ts`
is rewritten by the `export_types` test and now contains `simulateBackspaces`.

- [ ] **Step 6: Add it to the text service contract**

In `apps/whispering/src/lib/services/text/types.ts`, after
`simulateCopyKeystroke` in the `TextService` type:

```ts
	/**
	 * Simulates pressing Backspace `count` times, to remove text a previous
	 * synthetic paste delivered.
	 *
	 * One press deletes one grapheme cluster, so `count` is a grapheme count.
	 * The host refuses above 2000 rather than deleting part of the request.
	 *
	 * Note: only supported on desktop (Tauri). Web browsers cannot simulate
	 * keystrokes for security reasons.
	 */
	simulateBackspaces: (count: number) => Promise<Result<void, TextError>>;
```

- [ ] **Step 7: Implement it**

In `apps/whispering/src/lib/services/text/index.tauri.ts`, after
`simulateCopyKeystroke`:

```ts
	simulateBackspaces: async (count) => {
		const { error } = await commands.simulateBackspaces(count);
		if (error !== null) return TextError.SimulateKeystroke({ cause: error });
		return Ok(undefined);
	},
```

- [ ] **Step 8: Typecheck**

```bash
bun run --filter '@epicenter/whispering' typecheck
```

Expected: 0 errors. If the browser build has a second `TextService`
implementation, it must gain a `simulateBackspaces` that returns
`TextError.NotSupported({ operation: 'Simulating backspaces' })`; the typecheck
is what tells you whether one exists.

- [ ] **Step 9: Commit**

```bash
git add apps/epicenter/src-tauri/src/delivery.rs apps/epicenter/src-tauri/src/command_names.rs apps/epicenter/src-tauri/src/lib.rs apps/epicenter/src-tauri/capabilities/trusted-whispering-native-development.json apps/epicenter/src-tauri/capabilities/trusted-whispering-native-production.json apps/whispering/src/lib/tauri/bindings.gen.ts apps/whispering/src/lib/services/text/types.ts apps/whispering/src/lib/services/text/index.tauri.ts
git commit -m "feat(epicenter): add a capped backspace keystroke command"
```

---

### Task 3: Delivery reports which sink ran

The pipeline currently sees the delivered text and the reach, and nothing else.
Which sink ran is decided inside `delivery.ts` and never leaves it, so undo
cannot tell a cursor paste from a clipboard copy. One field fixes it for both
delivery entry points.

**Files:**
- Modify: `apps/whispering/src/lib/operations/sink.ts:12`
- Modify: `apps/whispering/src/lib/operations/delivery-reach.ts`
- Modify: `apps/whispering/src/lib/operations/delivery.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type SinkKind = 'cursor' | 'clipboard' | 'ledger'` from
  `sink.ts`, and `DeliveryOutcome = { reach: DeliveryReach; sinkKind: SinkKind }`.

- [ ] **Step 1: Export the sink kind**

In `apps/whispering/src/lib/operations/sink.ts`, change

```ts
type SinkKind = 'cursor' | 'clipboard' | 'ledger';
```

to

```ts
/**
 * Which destination ran. Part of the delivery outcome rather than a private
 * detail, because undo has to know whether the text went through a synthetic
 * paste: the clipboard and ledger sinks never touch the keyboard.
 */
export type SinkKind = 'cursor' | 'clipboard' | 'ledger';
```

- [ ] **Step 2: Put it on the outcome**

In `apps/whispering/src/lib/operations/delivery-reach.ts`, replace

```ts
export type DeliveryOutcome = { reach: DeliveryReach };
```

with

```ts
import type { SinkKind } from './sink';

export type DeliveryOutcome = { reach: DeliveryReach; sinkKind: SinkKind };
```

`sink.ts` already imports `DeliveryReach` from this file, so the two now
reference each other. Both directions are `import type`, which is erased at
compile time, so there is no runtime cycle and nothing to work around.

- [ ] **Step 3: Return it**

In `apps/whispering/src/lib/operations/delivery.ts`, inside `deliverToSink`,
change the returned outcome from `{ reach }` to:

```ts
		outcome: { reach, sinkKind: sink.kind },
```

Also re-export the type so callers keep one delivery import: add `SinkKind` to
the existing `export type { ... } from '$lib/operations/delivery-reach'` block
by adding a separate line:

```ts
export type { SinkKind } from '$lib/operations/sink';
```

- [ ] **Step 4: Typecheck and run the whole app suite**

```bash
bun run --filter '@epicenter/whispering' typecheck && bun run --filter '@epicenter/whispering' test
```

Expected: 0 type errors, all tests pass. `pipeline-auto-upload.test.ts` stubs
`deliverTranscriptionResult` with `{ outcome: { reach: 'output' }, notice: ... }`;
if the typecheck flags that stub, add `sinkKind: 'cursor'` to it.

- [ ] **Step 5: Commit**

```bash
git add apps/whispering/src/lib/operations/sink.ts apps/whispering/src/lib/operations/delivery-reach.ts apps/whispering/src/lib/operations/delivery.ts
git commit -m "feat(whispering): report the sink kind on the delivery outcome"
```

---

### Task 4: The held delivery

**Files:**
- Create: `apps/whispering/src/lib/state/last-delivery.svelte.ts`
- Test: `apps/whispering/src/lib/state/last-delivery.test.ts`

**Interfaces:**
- Consumes: `SinkKind` from `operations/sink`, `DeliveryReach` from
  `operations/delivery-reach` (Task 3).
- Produces: `lastDelivery.record({ text, sinkKind, reach })`,
  `lastDelivery.take(): { graphemes: number } | null`, and
  `lastDelivery.clear()`.

`take()` returns the grapheme count rather than the text, because the count is
the only thing undo needs and returning it here keeps the counting in one place.

- [ ] **Step 1: Write the failing test**

Create `apps/whispering/src/lib/state/last-delivery.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test';
import { lastDelivery } from './last-delivery.svelte';

beforeEach(() => lastDelivery.clear());

test('a clean cursor paste is undoable, counted in graphemes', () => {
	lastDelivery.record({ text: 'hello', sinkKind: 'cursor', reach: 'output' });
	expect(lastDelivery.take()).toEqual({ graphemes: 5 });
});

test('an emoji and a combining mark each count as one backspace', () => {
	// One backspace deletes one grapheme cluster, so a UTF-16 length would
	// overshoot and eat the words before it.
	lastDelivery.record({ text: '👨‍👩‍👧', sinkKind: 'cursor', reach: 'output' });
	expect(lastDelivery.take()).toEqual({ graphemes: 1 });

	// Written as e + U+0301 on purpose: a combining mark, not the single
	// precomposed character, or the test proves nothing.
	lastDelivery.record({ text: 'é', sinkKind: 'cursor', reach: 'output' });
	expect(lastDelivery.take()).toEqual({ graphemes: 1 });
});

test('nothing that skipped the keyboard is undoable', () => {
	lastDelivery.record({ text: 'hello', sinkKind: 'clipboard', reach: 'output' });
	expect(lastDelivery.take()).toBeNull();

	lastDelivery.record({ text: 'hello', sinkKind: 'ledger', reach: 'output' });
	expect(lastDelivery.take()).toBeNull();

	// A cursor write that could not paste left the text on the clipboard.
	lastDelivery.record({ text: 'hello', sinkKind: 'cursor', reach: 'clipboard' });
	expect(lastDelivery.take()).toBeNull();
});

test('the record is consumed once', () => {
	lastDelivery.record({ text: 'hello', sinkKind: 'cursor', reach: 'output' });
	expect(lastDelivery.take()).toEqual({ graphemes: 5 });
	expect(lastDelivery.take()).toBeNull();
});

test('nothing held reads as nothing to undo', () => {
	expect(lastDelivery.take()).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun run --filter '@epicenter/whispering' test last-delivery
```

Expected: FAIL, "Cannot find module './last-delivery.svelte'".

- [ ] **Step 3: Write the implementation**

Create `apps/whispering/src/lib/state/last-delivery.svelte.ts`:

```ts
/**
 * The one delivery "scratch that" can undo.
 *
 * Session-scoped and deliberately not persisted: a transcript delivered before
 * a restart is not something a backspace can find its way back to.
 *
 * Consumed once. A second "scratch that" must find nothing held rather than
 * deleting another paste's worth of characters.
 *
 * See `specs/20260829T120000-command-mode.md`.
 */
import type { DeliveryReach } from '$lib/operations/delivery-reach';
import type { SinkKind } from '$lib/operations/sink';

type Held = { text: string; sinkKind: SinkKind; reach: DeliveryReach };

let held: Held | null = null;

/**
 * Graphemes, not code units: one Backspace deletes one grapheme cluster, so a
 * `text.length` count would overshoot on an emoji or a combining mark and eat
 * the words the user typed before the paste.
 */
function countGraphemes(text: string): number {
	const segmenter = new Intl.Segmenter(undefined, {
		granularity: 'grapheme',
	});
	let count = 0;
	for (const _ of segmenter.segment(text)) count += 1;
	return count;
}

/**
 * Only a clean cursor paste can be undone. The clipboard and ledger sinks never
 * touch the keyboard, and a cursor write that fell back to `clipboard` did not
 * paste either, so there is nothing at the cursor to remove.
 */
function isUndoable(record: Held): boolean {
	return record.sinkKind === 'cursor' && record.reach === 'output';
}

export const lastDelivery = {
	/** Hold what was just delivered. Replaces anything held before it. */
	record(next: Held): void {
		held = next;
	},

	/**
	 * Take the held delivery, clearing it either way. Returns the number of
	 * backspaces that would undo it, or null when nothing is held or what is
	 * held never reached the cursor.
	 */
	take(): { graphemes: number } | null {
		const record = held;
		held = null;
		if (record === null || !isUndoable(record)) return null;
		return { graphemes: countGraphemes(record.text) };
	},

	/** Drop the held delivery without undoing it. */
	clear(): void {
		held = null;
	},
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun run --filter '@epicenter/whispering' test last-delivery
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/whispering/src/lib/state/last-delivery.svelte.ts apps/whispering/src/lib/state/last-delivery.test.ts
git commit -m "feat(whispering): hold the last delivery for undo"
```

---

### Task 5: The setting

No behavior yet: this task only makes the toggle exist, default off, and
discoverable. The pipeline reads it in Task 6.

**Files:**
- Modify: `apps/whispering/src/lib/workspace/index.ts:165`
- Modify: `apps/whispering/src/lib/whispering/app.ts:132`
- Modify: `apps/whispering/src/routes/(app)/(config)/settings/dictation/+page.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.settings.get('commandModeEnabled'): boolean`.

- [ ] **Step 1: Declare the field**

In `apps/whispering/src/lib/workspace/index.ts`, in `settingsKv`, immediately
after `polishInstructions: field.string(),`:

```ts
	commandModeEnabled: field.boolean(),
```

- [ ] **Step 2: Give it a default**

In `apps/whispering/src/lib/whispering/app.ts`, in the defaults object,
immediately after the `polishInstructions` line:

```ts
	commandModeEnabled: false,
```

Off by default on purpose: turning the dictated words "scratch that" into a
destructive keystroke is not something an existing user should meet by accident.

- [ ] **Step 3: Add the toggle and the phrase list**

In `apps/whispering/src/routes/(app)/(config)/settings/dictation/+page.svelte`,
add a third section. Insert it after the Polish `</Field.Set>` and its following
`<Field.Separator />`, before the Dictionary `<Field.Set>`:

```svelte
		<Field.Set>
			<Field.Legend variant="label">Command Mode</Field.Legend>
			<Field.Description>
				A short list of spoken phrases that do something instead of being
				typed. Say one on its own, with nothing else in the same breath.
			</Field.Description>
			<Field.Group>
				<SettingSwitch
					key="commandModeEnabled"
					label="Act on spoken commands"
					description="Off by default, because these phrases stop being text the moment you turn this on."
				/>
				{#if app.settings.get('commandModeEnabled')}
					<ul class="text-muted-foreground space-y-1 text-sm">
						<li>
							<span class="text-foreground font-medium">"scratch that"</span>
							or
							<span class="text-foreground font-medium">"undo that"</span>
							removes what was just typed at your cursor.
						</li>
						<li>
							<span class="text-foreground font-medium">"stop listening"</span>
							ends a voice activated session.
						</li>
					</ul>
				{/if}
			</Field.Group>
		</Field.Set>

		<Field.Separator />
```

- [ ] **Step 4: Typecheck**

```bash
bun run --filter '@epicenter/whispering' typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/whispering/src/lib/workspace/index.ts apps/whispering/src/lib/whispering/app.ts "apps/whispering/src/routes/(app)/(config)/settings/dictation/+page.svelte"
git commit -m "feat(whispering): add the command mode setting and phrase list"
```

---

### Task 6: The runner and the pipeline branch

**Files:**
- Create: `apps/whispering/src/lib/operations/run-voice-command.ts`
- Modify: `apps/whispering/src/lib/operations/pipeline.ts`
- Test: `apps/whispering/src/lib/operations/command-mode-pipeline.test.ts`

**Interfaces:**
- Consumes: `matchCommand`, `VoiceCommandId` (Task 1);
  `services.text.simulateBackspaces` (Task 2); `lastDelivery` (Task 4);
  `commandModeEnabled` (Task 5); `stopVadRecording`, `isVadRecordingActive`
  from `operations/recording`.
- Produces: `commandApplies(id: VoiceCommandId): boolean` and
  `runVoiceCommand(app: WhisperingApp, id: VoiceCommandId): Promise<void>`.

- [ ] **Step 1: Export the VAD liveness check**

`isVadRecordingActive` in `apps/whispering/src/lib/operations/recording.ts:118`
is module-private. Add `export` to it, and extend its docstring with one line:

```ts
/** True while a VAD session is armed, whether or not speech is being heard. */
export function isVadRecordingActive() {
```

- [ ] **Step 2: Write the runner**

Create `apps/whispering/src/lib/operations/run-voice-command.ts`:

```ts
/**
 * The effect half of Command Mode. `match-command` stays pure and app-free;
 * everything that touches live state lives here.
 *
 * See `specs/20260829T120000-command-mode.md`.
 */
import { createLogger } from 'wellcrafted/logger';
import type { VoiceCommandId } from '$lib/operations/match-command';
import { isVadRecordingActive, stopVadRecording } from '$lib/operations/recording';
import { report } from '$lib/report';
import { services } from '$lib/services';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
import type { WhisperingApp } from '$lib/whispering/app';

const log = createLogger('whispering/voice-command');

/**
 * Whether this command has anything to act on right now.
 *
 * A matched phrase is not enough to swallow an utterance. `isDictation` is true
 * in manual mode as well as VAD, so "stop listening" during a manual dictation
 * would otherwise match, do nothing, and eat the words: no text and no action.
 * An inapplicable command falls through and delivers as ordinary text instead.
 *
 * `scratchThat` always applies: it reports its own "nothing to undo" case
 * rather than doing nothing silently.
 */
export function commandApplies(id: VoiceCommandId): boolean {
	switch (id) {
		case 'scratchThat':
			return true;
		case 'stopListening':
			return isVadRecordingActive();
	}
}

export async function runVoiceCommand(
	app: WhisperingApp,
	id: VoiceCommandId,
): Promise<void> {
	switch (id) {
		case 'scratchThat':
			return scratchThat();
		case 'stopListening':
			log.info('Voice command stopped the listening session');
			return stopVadRecording(app);
	}
}

async function scratchThat(): Promise<void> {
	const undo = lastDelivery.take();
	if (undo === null) {
		report.info({
			title: 'Nothing to undo',
			description:
				'There is no dictation at your cursor to remove. Only text Whispering pasted at the cursor can be taken back.',
		});
		return;
	}

	const { error } = await services.text.simulateBackspaces(undo.graphemes);
	if (error !== null) {
		// The held record is already gone, which is what we want: after a partial
		// delete the count no longer describes what is on screen.
		report.error({ title: "Couldn't undo the last dictation", cause: error });
		return;
	}
	log.info('Voice command undid the last dictation', {
		graphemes: undo.graphemes,
	});
}
```

- [ ] **Step 3: Write the failing pipeline test**

Create `apps/whispering/src/lib/operations/command-mode-pipeline.test.ts`.
This copies the module-mocking fixture from `pipeline-auto-upload.test.ts`,
which is how the pipeline is testable at all: the aliases bun cannot resolve are
registered explicitly before importing the pipeline.

```ts
/**
 * The pipeline branch Command Mode adds.
 *
 * What these lock down is the placement argument: a command intercepts the
 * transcript before Polish, before snippets, before the completion sound and
 * before delivery, and only when it is both enabled and applicable.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { generateBlobId } from '@epicenter/blobs';
import { Ok } from 'wellcrafted/result';
import type { RecordingId } from '$lib/workspace';
import { expandSnippets } from './expand-snippets';
import { matchCommand } from './match-command';

let commandModeEnabled = true;
let transcript = 'scratch that';
let applies = true;
const runVoiceCommand = mock(async () => {});
const deliverTranscriptionResult = mock(async () => ({
	outcome: { reach: 'output', sinkKind: 'cursor', pressedEnter: false } as const,
	notice: { title: 'done' },
}));
const playSoundIfEnabled = mock(async () => Ok(undefined));
const recordDelivery = mock();

mock.module('$lib/operations/expand-snippets', () => ({ expandSnippets }));
// The matcher is pure, so the real one runs here: a stub would hide the very
// coupling this file exists to check.
mock.module('$lib/operations/match-command', () => ({ matchCommand }));
mock.module('$lib/operations/run-voice-command', () => ({
	commandApplies: () => applies,
	runVoiceCommand,
}));
mock.module('$lib/operations/delivery', () => ({ deliverTranscriptionResult }));
mock.module('$lib/operations/run-polish', () => ({
	polishWillRun: () => false,
	runPolish: async (_app: unknown, { input }: { input: string }) => Ok(input),
}));
mock.module('$lib/operations/sound', () => ({ playSoundIfEnabled }));
mock.module('$lib/operations/transcribe', () => ({
	transcribeAndPersist: async () => Ok({ text: transcript, history: Ok(undefined) }),
}));
mock.module('$lib/operations/transcription-history', () => ({
	saveRecordingHistory: mock(async () => Ok(undefined)),
}));
mock.module('$lib/report', () => ({
	log: { warn: mock() },
	report: {
		info: mock(),
		error: mock(),
		loading: () => ({ resolve: mock(), reject: mock() }),
	},
}));
mock.module('$lib/state/dictation-lifecycle.svelte', () => ({
	dictationLifecycle: {
		markTranscribing: mock(),
		markFailed: mock(),
		markPolishing: mock(),
		markDelivered: mock(),
	},
}));
mock.module('$lib/state/polish-hud.svelte', () => ({
	polishHud: { begin: mock(), end: mock() },
}));
mock.module('$lib/state/last-delivery.svelte', () => ({
	lastDelivery: { record: recordDelivery, take: mock(), clear: mock() },
}));

const { processRecordingPipeline } = await import('./pipeline.js');
type WhisperingApp = import('$lib/whispering/app').WhisperingApp;

const app = {
	settings: {
		get: (key: string) =>
			key === 'commandModeEnabled' ? commandModeEnabled : false,
	},
	recordings: {
		create: (fields: Record<string, unknown>) => ({
			...fields,
			id: 'recording-1' as RecordingId,
		}),
		uploadAudio: mock(async () => Ok(undefined)),
		update: mock(async () => Ok(undefined)),
	},
	snippets: { all: [] },
} as unknown as WhisperingApp;

function run(deliverySource: 'recording' | 'import' = 'recording') {
	return processRecordingPipeline(app, {
		audioBlobId: generateBlobId(),
		durationMs: 100,
		deliverySource,
	});
}

afterEach(() => {
	commandModeEnabled = true;
	transcript = 'scratch that';
	applies = true;
	runVoiceCommand.mockClear();
	deliverTranscriptionResult.mockClear();
	playSoundIfEnabled.mockClear();
	recordDelivery.mockClear();
});

test('a command runs instead of being delivered', async () => {
	await run();
	expect(runVoiceCommand).toHaveBeenCalledTimes(1);
	expect(runVoiceCommand).toHaveBeenLastCalledWith(app, 'scratchThat');
	expect(deliverTranscriptionResult).not.toHaveBeenCalled();
	// No text arrived anywhere, so there is no receipt to sound.
	expect(playSoundIfEnabled).not.toHaveBeenCalled();
});

test('ordinary speech is untouched', async () => {
	transcript = 'scratch that idea and move on';
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenCalledTimes(1);
});

test('the setting gates the whole branch', async () => {
	commandModeEnabled = false;
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'scratch that',
		source: 'recording',
	});
});

test('an inapplicable command delivers as text instead of vanishing', async () => {
	transcript = 'stop listening';
	applies = false;
	await run();
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenLastCalledWith(app, {
		text: 'stop listening',
		source: 'recording',
	});
});

test('an imported file never fires a command', async () => {
	await run('import');
	expect(runVoiceCommand).not.toHaveBeenCalled();
	expect(deliverTranscriptionResult).toHaveBeenCalledTimes(1);
});

test('a delivered dictation is held for undo, an import is not', async () => {
	transcript = 'hello world';
	await run();
	expect(recordDelivery).toHaveBeenCalledTimes(1);
	expect(recordDelivery).toHaveBeenLastCalledWith({
		text: 'hello world',
		sinkKind: 'cursor',
		reach: 'output',
		pressedEnter: false,
	});

	recordDelivery.mockClear();
	await run('import');
	expect(recordDelivery).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
bun run --filter '@epicenter/whispering' test command-mode-pipeline
```

Expected: FAIL. The first test fails because nothing calls `runVoiceCommand`.

- [ ] **Step 5: Add the branch to the pipeline**

In `apps/whispering/src/lib/operations/pipeline.ts`, add the imports:

```ts
import { matchCommand } from '$lib/operations/match-command';
import {
	commandApplies,
	runVoiceCommand,
} from '$lib/operations/run-voice-command';
import { lastDelivery } from '$lib/state/last-delivery.svelte';
```

Then, immediately after `let history = transcription.history;` and before the
`willPolish` block, insert:

```ts
	// Command Mode intercepts here, before Polish: Polish would reword "scratch
	// that" into prose, so a matcher downstream of it would only ever see the
	// phrase destroyed. A match ends the pipeline, so nothing below runs: no
	// snippet expansion, no polished write, no completion sound, no delivery.
	//
	// Live capture only, and applicable only. `isDictation` is true in manual
	// mode as well as VAD, so a phrase whose target is not live falls through and
	// delivers as ordinary text rather than silently eating the utterance.
	if (isDictation && app.settings.get('commandModeEnabled')) {
		const command = matchCommand(transcribedText);
		if (command !== null && commandApplies(command)) {
			await runVoiceCommand(app, command);
			return;
		}
	}
```

Then, after the `deliverTranscriptionResult` call and before the
`if (isDictation)` block that marks the pill, insert:

```ts
	// Hold what was delivered so "scratch that" has something to take back.
	// Dictation only: undoing a file import would target a paste the person
	// never dictated. The outcome carries the sink kind and whether an Enter
	// followed, which is what decides whether a backspace can reach it at all.
	if (isDictation) {
		lastDelivery.record({
			text: deliveredText,
			sinkKind: transcriptDelivery.sinkKind,
			reach: transcriptDelivery.reach,
			pressedEnter: transcriptDelivery.pressedEnter,
		});
	}
```

- [ ] **Step 6: Run the new test to verify it passes**

```bash
bun run --filter '@epicenter/whispering' test command-mode-pipeline
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole app suite and typecheck**

```bash
bun run --filter '@epicenter/whispering' test && bun run --filter '@epicenter/whispering' typecheck
```

Expected: all tests pass, 0 type errors. `pipeline-auto-upload.test.ts` stubs
`app.settings.get` with a key-blind function returning its auto-upload flag, so
the new `commandModeEnabled` read there returns `true` while its transcript is
the string `'transcript'`, which matches no phrase. If that file now fails, the
fix is to make its stub key-aware, not to weaken the branch.

- [ ] **Step 8: Commit**

```bash
git add apps/whispering/src/lib/operations/run-voice-command.ts apps/whispering/src/lib/operations/command-mode-pipeline.test.ts apps/whispering/src/lib/operations/pipeline.ts apps/whispering/src/lib/operations/recording.ts
git commit -m "feat(whispering): run spoken commands instead of delivering them"
```

---

### Task 7: Verify in the desktop shell

The keystroke path cannot run under `bun test`. This is the same hand
verification the Snippets seam got, and it is the only check that the
Accessibility grant, the capability file and the backspace count agree.

**Files:** none. This task produces evidence, not a diff.

- [ ] **Step 1: Start the desktop app**

```bash
bun dev:epicenter
```

- [ ] **Step 2: Turn Command Mode on**

Settings, Dictation, "Act on spoken commands". Confirm the phrase list appears
under the toggle when it is on and disappears when it is off.

- [ ] **Step 3: Confirm cursor output is on**

Settings, Recording output: "write to cursor" must be on, or undo has nothing to
reach and will correctly refuse. On macOS the Accessibility grant must be
present.

- [ ] **Step 4: Undo a real dictation**

Put the cursor in a plain text field. Dictate a sentence, let it land, then
dictate "scratch that" on its own. The sentence should disappear, character for
character, leaving anything you typed before it intact.

- [ ] **Step 5: Undo twice**

Say "scratch that" again straight away. Expect the "Nothing to undo" notice and
no keystrokes.

- [ ] **Step 6: Confirm the clipboard case refuses**

Turn cursor output off, leaving clipboard output on. Dictate a sentence, then
"scratch that". Expect the "Nothing to undo" notice, not a burst of backspaces
into whatever has focus.

- [ ] **Step 7: Stop a VAD session by voice**

Turn cursor output back on. Start a voice activated session, say something, let
it deliver, then say "stop listening". The session should end.

- [ ] **Step 8: Confirm the manual-mode fall-through**

In manual mode, with no VAD session, dictate "stop listening". The words should
be delivered as text. This is the bug the applicability guard exists to prevent,
so it is the single most important check in this task.

- [ ] **Step 9: Confirm an emoji counts as one**

Dictate something, then paste an emoji at the end by hand so the delivered text
is unchanged, and confirm undo still removes exactly the dictated text. If the
provider returns an emoji in a transcript, undo it directly and confirm one
backspace clears it.

- [ ] **Step 10: Record the evidence**

Note the result of each check in the commit message or the PR body. Nothing is
"verified" without it.

---

## Self-review

**Spec coverage.** Matcher and normalization rule: Task 1. Dictation-only and
opt-in guards, and the early return before Polish, snippets, the sound and
delivery: Task 6. Applicability and the fall-through: Tasks 6 and 7. Held state,
grapheme counting, the undoable predicate and consume-once: Task 4. The
`DeliveryOutcome` change the held state depends on: Task 3. Backspace host
command and the 2000 cap: Task 2. Settings toggle and phrase list: Task 5.
Failure table rows: the "nothing to undo" and backspace-failure branches in Task
6's runner, the cap refusal in Task 2's Rust, the fall-through in Task 6's test.
Manual verification: Task 7.

**Not covered by an automated test, on purpose.** The keystroke itself and the
Accessibility grant, both in Task 7.

The cap is enforced in both languages and tested in TypeScript. An earlier draft
of this plan said the TypeScript side never constructs a count above the cap and
so needed no check. That was wrong: `lastDelivery.take()` returns an uncapped
grapheme count, so a long dictation reaches it. Worse, the host's refusal arrives
as the same opaque error as any other keystroke failure, so without a check in
TypeScript an over-long undo reads to the person as an error rather than the calm
notice the design promises.

**Deferred, per the spec.** pause and resume, text shaping, mid-stream matching.
No task touches them.
