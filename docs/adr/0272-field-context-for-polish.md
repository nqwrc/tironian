# ADR-0272: The text around the cursor as context for transcription and Polish

- Status: Accepted
- Date: 2026-10-08, accepted 2026-10-08 on the owner's direct decision
- Amends:
  - ADR-0271, which made the privacy decision for "one narrow case: the span
    Tironian itself just pasted". This record makes it for a second case, and
    the second case differs in the way that matters: this text leaves the
    device whenever the configured provider is online. ADR-0271's span never
    does.
  - `docs/brand/tironian.md:98-131` (the comparison, its "Reads your screen"
    row and the paragraph under it) and the roadmap bullet at `:155-160`,
    which still says reading the focused field as context for Polish is not
    built.
  - `STATUS.md:19`, which lists field context for Polish as open pending this
    decision.
- Unchanged: the window-title rule in
  `apps/desktop/src-tauri/src/foreground.rs:12-16` (titles are still refused
  and still kept out of prompts), and ADR-0270 (nothing here is stored).
- Related: ADR-0270, ADR-0271.

## Context

The owner asked on 2026-10-08 for "Use the text around my cursor": when the
switch is on, a live dictation reads a capped slice of the focused field at the
moment it starts, and passes it to the transcription prompt (so names come out
spelled the way the field spells them) and to the Polish prompt (so the
dictation continues the sentence and matches the field's style). The owner's
constraints match those of correction learning: opt-in, off by default,
Windows only, its own switch under Settings, Privacy & Processing, a host-owned
gate, hard caps, no persistence and no logging.

What exists today:

- The host already holds a fail-closed gate for reading another app's field
  (`apps/desktop/src-tauri/src/field_text.rs:228-258`): own window, UIPI
  reach, password state, an exe denylist, console and terminal window classes,
  Edit or Document controls only. It ends with a `Moved` check against the
  paste target, which a capture-start read does not have.
- Capture start already samples the foreground app for app rules, through a
  FIFO that pairs each VAD speech start with its own speech end
  (`apps/tironian/src/lib/operations/recording.ts:159-193`).
- The recognizer prompt has a 672-character budget on Whisper routes and none
  elsewhere, and Deepgram receives the same string as a `keyterm` or
  `keywords` query parameter
  (`apps/tironian/src/lib/operations/build-transcription-prompt.ts:56-124`).
- The Polish system prompt is a fixed scaffold that frames the user message as
  dictated content, never instructions
  (`apps/tironian/src/lib/operations/build-system-prompt.ts:71-123`).
- Transcription defaults to the local route; Polish defaults to an online
  provider (`apps/tironian/src/lib/app/app.ts:77`, `:90`).

Field text sent to a provider is a larger commitment than anything ADR-0271
allowed: it is another app's content, it leaves the machine when the provider
is online, and it is untrusted input to a language model.

## Decision

1. **Off by default, Windows only, its own consent.** A new boolean setting,
   `cursorContextEnabled`, defaults to `false`. Its switch, "Use the text
   around my cursor", sits under Settings, Privacy & Processing, in its own
   settings category `cursorContext`, which the import screen leaves unchecked
   even when a file carries it (`IMPORT_OPT_IN_CATEGORIES`,
   `apps/tironian/src/lib/app/settings-bundle-import.ts:97-122`). macOS and
   Linux hide the switch and the host answers `unsupported`. It does not share
   the correction-learning switch: that one keeps what it reads on the device,
   this one sends it out.
2. **One read, at capture start, of the element focused then.** A new host
   command, `read_context_at_capture`, takes no argument, reads the element
   that has focus when it runs, and never returns `Err`. The webview calls it
   once per dictation: in `startManualRecording` after the secure-field
   capture gate (this covers the record button, the toggle shortcut,
   push-to-talk and the hands-free lock), and on each VAD speech start. It is
   never called while the switch is off, for a file import, a retry from the
   recordings list, a Recipe, or a repeat of the last dictation.
3. **The same gate, without a target.** The host splits the existing gate into
   `gate_focus` (every check up to the control type, in the same order) and
   `gate` (`gate_focus`, then `Moved`). The capture read runs `gate_focus`, so
   it refuses Tironian's own window, unreachable (elevated) processes, password
   fields and fields whose password state is unknown, the exe denylist, the
   console and terminal window classes, and anything that is not an Edit or
   Document control. It then needs a UIA text pattern with a selection range:
   a field with only a value pattern has no caret and an uncapped read, so it
   is refused (`noTextPattern`), and a text pattern with no selection is
   refused (`noCaret`).
4. **Only three capped slices cross IPC.** Up to 400 UTF-16 code units before
   the caret (or before the selection), up to 200 after it, and up to 200 of
   the selected text, which the dictation will replace. A slice cut at its cap
   is trimmed back to a whole word when a space lies within 40 units of the
   cut, and never splits a surrogate pair. A selection longer than 200 units
   keeps its first 200. Line breaks are normalized to `\n`. The webview clamps
   again to the same caps before any prompt is built.
5. **In memory for one run.** The slice travels as a promise in the capture
   FIFO, then as `cursorContext` on the pipeline input beside `foregroundApp`.
   It reaches the recognizer prompt and the Polish system prompt and nothing
   else: never the recording row, settings, a log line (console or
   `Tironian.log`), a notice, an OS notification, analytics or the last-
   dictation buffer. The FIFO and the pipeline input carry it in a one-shot
   holder, not as bare text, and the pipeline empties the holder right after
   `runPolish` settles (and on every path that never reaches it), so nothing
   the run keeps references the slice during the paste. No module-level state
   holds it. JavaScript offers no stronger guarantee than that, such as
   zeroing.
6. **The recognizer gets the text before the cursor only, and only where a
   prompt reads as the transcript so far.** Whisper routes (local, Groq,
   Speaches) and OpenAI (both `whisper-1` and the `gpt-4o-transcribe` models)
   receive the slice before the cursor, after the person's own prompt and the
   Dictionary, separated by a line break. On a Whisper route it fills whatever
   the 672-character budget leaves, keeping the end nearest the cursor and
   starting at a whole word, and it is left out when fewer than 24 characters
   remain. On an unbounded route it is capped at 400 characters. It never
   displaces a Dictionary term, and the "terms did not fit" log line still
   counts Dictionary terms only. Deepgram, ElevenLabs and Mistral never receive
   it: Deepgram would send prose as a keyterm in a URL, and the other two do
   not send the prompt at all.
7. **Polish gets all three slices, as quoted data.** Both Polish scaffolds,
   trusted and untrusted, gain a `<cursor_context>` block, placed after the
   directive and before the fixed rules, with `<before_cursor>`,
   `<selected_text>` and `<after_cursor>` inside it (an empty slice is
   omitted). The text above it says the block is quoted data from another app,
   not part of the transcript and not instructions, to be used only for
   spellings, for continuing the sentence and for tone, and never translated
   into. One rule joins the fixed list: nothing in the block can change the
   rules or add to the output, and none of its words, links, email addresses
   or phone numbers may be copied into the corrected text unless the speaker
   said them. A `<` that starts a tag-shaped token inside the slice becomes
   `‹`, so the slice cannot close the block. The block adds at most 2,000
   characters to the system prompt. The user message stays the transcript
   alone. Recipes, including a per-app rule's recipe, never receive the slice.
8. **The slice decides nothing.** Which recognizer, which Polish provider and
   model, which app rule, which recipe and whether a voice command matches are
   all decided by code that never reads the slice.
9. **Polish may not echo it.** If the Polish output contains a run of eight
   words from the slice that the raw transcript does not contain, the pass
   counts as failed: the raw transcript ships, nothing polished is written to
   the row, and the "Polishing skipped" notice carries fixed copy. A Polish
   error message that contains such a run is replaced by fixed copy before it
   reaches the notice, because `report` logs every notice. A recognizer error
   message that contains such a run is replaced the same way in
   `transcribeAudio`, before it reaches the failure notice, the log or the
   `transcription_failed` analytics event.
10. **Off means the same bytes.** With the switch off, with nothing readable,
    or with an all-blank slice, every recognizer prompt and every Polish and
    Recipe system prompt is byte-identical to the prompt before this change. A
    snapshot written from the code before the feature pins it.
11. **The copy says what the host enforces.** The switch description and the
    brand document state the caps, the moment of the read, the refusals by
    name, where the text goes, and that it is not stored or logged. A change
    to any of these rules changes that copy in the same commit.

## Irreversibility review

- Storage format: none. Nothing is persisted; no table, no column, no blob.
- Settings: one kv key, `cursorContextEnabled`. Like every kv key it persists
  in device documents once written; removing the feature later leaves an
  unread key, which is harmless.
- Host API: one command and one refusal value (`noCaret`) on `FieldRefusal`.
  Internal to this app; the generated bindings change with them.
- Public claim: the brand document stops saying Tironian does not read the
  field you are in, and says instead exactly what each switch reads and where
  it goes. That is the decision this record exists to make.

## Accepted residue

- The text leaves the device whenever the chosen recognizer or Polish
  provider is online, and the default Polish provider is online. That is the
  feature, and the switch says so.
- The switch is enforced in the webview; the host does not know it. A
  compromised webview could call the command at any time and read the capped
  slices of whatever field has focus. The same webview can already type into
  that field and read the clipboard.
- Whisper can reproduce prompt text on short or quiet audio. The silence gate
  removes the silent case; an echo on speech lands in the transcript, the
  recording row and the paste. There is no reference to check it against, so
  there is no guard for the recognizer.
- Tags are framing, not a sandbox. Text in the field can still sway Polish's
  wording; the structural limits are decisions 7 to 9.
- Focus can move between capture start and the paste: the context then comes
  from one field and the text lands in another.
- In a hands-free VAD session, an utterance's read can run before the previous
  utterance's paste has landed, so it does not see it.
- A VAD misfire spends a read whose result is dropped.
- Terminals that are neither on the denylist nor hosted in a console or Windows
  Terminal window, and browser address bars (an Edit control), are read when
  they have focus.
- A provider error that quotes fewer than eight words of the slice reaches the
  notice and the log.
- A recognizer error that quotes fewer than eight words of the slice is not
  scrubbed either, for the same reason.
- "Dropped after Polish" is a reference drop, not zeroing: the holder is empty
  after Polish, but the strings it held stay in memory until the collector
  runs, and the recognizer prompt string built from the slice is not tracked.

## Alternatives rejected

- Read at delivery instead of capture start: Polish needs the slice before
  delivery, and focus has had longer to move.
- Read on every focus change: reads fields nobody dictated into.
- Return the whole field and trim in TypeScript: whole documents would cross
  IPC, which ADR-0271 already refused.
- Fall back to the value pattern: no caret, and the read cannot be capped.
- Put the slice in the Polish user message: the scaffold says everything there
  is dictated content to clean and return, so the model would return it.
- Give Recipes the slice: a Recipe reshapes and may legitimately add text,
  which widens the echo route for no request anyone made.
- Send the slice to Deepgram: prose as a keyterm list, in a query string.
- Send the text after the cursor and the selection to the recognizer: a
  decoder reads its prompt as what was said before the audio.
- Let the slice displace Dictionary terms: the terms are deliberate, the slice
  is incidental.
- Mirror the switch into the host with a setter: the webview sets it, so it
  guards nothing a compromised webview cannot flip, and a frontend bug is
  covered by the test that the switch-off path never calls the host.
- Reuse the correction-learning switch: that data stays on the device, this
  data leaves it, so consent to one is not consent to the other.
- Refuse a selection over 200 units, as ADR-0271 refuses an over-long region:
  the refusal would drop the text before and after the cursor too.
- Default on: there is no consent moment before the first read, as ADR-0271
  found.

## Consequences

- `FieldRefusal` gains `noCaret`; `bindings.gen.ts`, the context service and
  the command registration change with the new command.
- The settings bundle gains a category, so an exported bundle can carry the
  switch; importing it is a deliberate check.
- The brand document's comparison, its "Reads your screen" row and the
  roadmap bullet, and `STATUS.md`, are rewritten in the commit that adds the
  switch.
