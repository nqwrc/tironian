# ADR-0271: Reading around the text Tironian pasted

- Status: Accepted
- Date: 2026-10-07, revised and accepted 2026-10-08 after the privacy and
  correctness reviews
- Amends:
  - the data-class rule in `apps/desktop/src-tauri/src/foreground.rs:12-16`
    ("window titles are refused ... must keep out of prompts, logs, and synced
    rows"). That rule still holds for `get_foreground_context`.
  - `docs/brand/tironian.md:98-119` (the comparison section and its
    "Reads your screen" row) and the roadmap bullets at `:143-151`.
  - `STATUS.md:19` (field context needs "a privacy decision first"). This ADR
    is that decision for one narrow case: the span Tironian itself just pasted,
    and only when the person turned it on.
- Related: ADR-0270 (where learned terms are stored)

## Context

The owner decided on 2026-10-08 to build learning from corrections: Windows
only, off by default, with the switch under Settings, Privacy & Processing.
Tironian reads only the field it just pasted into, a capped span, never
terminals or password managers; a new term stays pending until the person
accepts it or the same correction shows up again; and the brand document says
exactly what is read. This record turns that decision into rules the host
enforces.

To learn from corrections, Tironian must see what the person left in the field
after it pasted. No code reads field text today. The only UI Automation call is
`CurrentIsPassword` (`foreground.rs:373-395`). Field text is a larger data class
than the window titles the module already refuses: in Word or Outlook the
focused element is the whole document, quoted email threads included.

The first draft of this ADR let the webview ask for the focused field's full
text, checked the target app only in TypeScript after the text had crossed IPC,
and defaulted on. The reviews showed each of those breaks the privacy rule it
claimed. This revision moves every rule into the host.

## Decision

1. **Off by default.** `learnFromCorrectionsEnabled` defaults to `false` on
   every platform. The switch lives under Settings, Privacy & Processing, in its
   own settings category (`correctionLearning`), so importing the Dictionary
   category never turns reading on. There is no first-run screen, so the reason
   `analyticsEnabled` ships off (`apps/tironian/src/lib/app/app.ts:94-97`) holds
   here unchanged. Windows only: macOS and Linux refuse every read and hide the
   switch.
2. **No target, no read.** `write_text` takes a new `observe` argument. Only
   when it is true, and only on Windows, `write_text` captures the focused
   element at paste time and, after a successful paste, records one
   `PasteTarget`: the element's UIA RuntimeId, its process id from
   `IUIAutomationElement::CurrentProcessId`, the delivered text, a deadline 90 s
   after the paste, and a budget of 6 reads. Every other `write_text`, every
   synthetic Enter or backspace clears it, and so does `end_field_observation`
   when given the target's generation. Every read result carries that
   generation, and the frontend closes with the last one it saw, so an old
   observation closing late cannot cancel the target the next dictation has
   armed. With no live target the read refuses before any COM call.
3. **The gate runs in the host, on the focused element and the windows that
   host it.** The app id and the UIPI reach check come from the focused
   element's process id, not from the foreground window, so one app's id can
   never be attached to another app's element. Before any text pattern is
   queried, `read_focused_text` refuses in this order:
   - no live target (none, expired, or budget spent): `noTarget`;
   - no focused element, or one the OS will not identify: `noFocus`;
   - the element belongs to Tironian's own process, or its top-level window
     does: `ownWindow`. Tironian's own fields render in a WebView2 child
     process, so the element's process alone would miss them;
   - the element's process sits above Tironian's integrity level: `unreachable`;
   - `CurrentIsPassword` is true or cannot be read: `secure`. This check fails
     closed, unlike the guard;
   - `denied`, when any of these holds:
     - the element's app is on the exe denylist, or its app id cannot be read.
       The denylist: terminals (`windowsterminal.exe`, `openconsole.exe`,
       `conhost.exe`, `cmd.exe`, `powershell.exe`, `pwsh.exe`,
       `wezterm-gui.exe`, `wezterm.exe`, `alacritty.exe`), password managers
       (`keepass.exe`, `keepassxc.exe`, `1password.exe`, `bitwarden.exe`) and
       `mstsc.exe`;
     - a console or terminal window class appears on the element, on an
       ancestor up to the first one with a window, on that window, or on its
       top-level window: `ConsoleWindowClass`, `PseudoConsoleWindow`,
       `CASCADIA_HOSTING_WINDOW_CLASS`, `TermControl`, compared without regard
       to case. A classic console can report its client (`ssh.exe`,
       `python.exe`) as the element's process, which no exe list covers;
     - any of those class names cannot be read, or no window is found within
       64 parent steps;
   - the element's control type is neither Edit nor Document: `notATextField`;
   - the element's RuntimeId or process id differ from the target's: `moved`.
4. **Only the span crosses IPC.** The host locates the text itself and returns
   `{ before, region, after }`:
   - The first read finds the delivered text, which must occur exactly once
     (`notFound` otherwise), keeps up to 32 UTF-16 units on each side as anchors
     inside the target, and returns them with the delivered text as the region.
   - Later reads find the stored `before` anchor exactly once, then the first
     `after` anchor past it, and return the anchors with the text between.
   - Each anchor holds at most 32 units. Between two anchors the region is
     capped at `2 * delivered + 200` units. An empty anchor means the paste
     touched that end of the field and the region runs to it, so the region is
     then capped at `delivered + 32`: a respelling and a word typed after it
     fit, a reply typed on after the paste does not. Anything longer is refused
     (`tooLong`), never truncated. An anchor made only of line terminators
     (`\r`, `\n`, `\r\n`, U+2029) counts as empty on both search paths: Word and
     RichEdit end a document with a paragraph mark, and a paste at its visible
     end would otherwise take the looser cap.
   - The webview never sends a search string, so it cannot steer the read
     anywhere but around Tironian's own output.
5. **Two ways to search, one answer.** `IUIAutomationTextRange::FindText` is
   tried first, so most of a long document never enters the host. When the
   pattern has no FindText or FindText misses (UIA text often carries `\r`
   where the delivery had `\n`), the host reads at most 100,000 UTF-16 units
   with `GetText`, normalizes newlines, and searches in Rust. A field longer than
   that is refused. Both paths apply the same rules and the same caps.
6. **Never `Err`.** Every failure is a `Refused { reason }`, and the frontend
   treats any refusal as "learn nothing".
7. **The webview keeps almost nothing.** It holds each span in local variables
   for one comparison. Between reads it keeps only the previous read's candidate
   folds, dropped when the observation closes (85 s on the frontend timer, 90 s
   in the host at most).
8. **What leaves the device.** Field text never goes to a recording row,
   settings, logs, notices, analytics, or a network call. A learned term is
   stored (ADR-0270) and, once active, is sent in prompts to the transcription,
   Polish and Recipe providers the person configured, like any dictionary term.
   The switch's description says so. No notice and no log line carries a
   learned term: notices use fixed copy, and the recognizer budget log reports
   a count.
9. **The learner refuses more than it learns.** A delivery under 3 words is
   never observed. A term containing a digit, `@`, `://` or `www.` is refused.
   A hunk that crosses a sentence end is refused. A hunk that reaches the end
   of the region, wherever the paste sits, and one at the start of a field (an
   empty `before` anchor), has its typed side trimmed to its best match: the
   caret sits at the end of the paste, so typing on joins the last hunk. An
   observation closes for good when the region is empty or fewer than half the
   delivered words still match. The next-dictation read learns only when it
   equals the previous timer read. Every new term starts pending (ADR-0270).
10. **The copy states what the host enforces, and nothing more.** The switch
    description and the brand document state the window, the read budget,
    both region caps, the anchor size, the 100,000-unit search, and the
    refusals by name: password fields, console windows, Windows Terminal,
    WezTerm, Alacritty, Remote Desktop and the four password managers above.
    They do not promise to refuse terminals in general. A change to any of
    these rules changes that copy in the same commit.

## Accepted residue

- A co-author in a shared document, or a grammar extension, can edit the
  pasted span, and a Polish or Recipe output can be "corrected" for style rather
  than recognition. Such terms can reach the pending list. They reach a prompt
  only after the person accepts them or the same fold shows up in a later
  dictation.
- A chat box that held only the paste: after the person sends with a physical
  Enter, a next message of at most `delivered + 32` units crosses IPC on the
  next read, once, before the gone rule closes the observation. A longer one is
  refused in the host.
- A word typed inside the paste right after a respelled word, not at the end of
  the region, joins the term ("cubernetes now" to "Kubernetes team now"). The
  term waits as pending and the person can forget it.
- Terminals that are neither on the exe denylist nor hosted in a console or
  Windows Terminal window, such as an editor's integrated terminal or another
  terminal emulator, are not refused by name. The read still needs the
  delivered text found exactly once in an Edit or Document element, and the
  copy does not claim them.
- Win32 RuntimeIds embed a window handle, which Windows reuses. A dialog rebuilt
  within 90 s can pass the `moved` check. The password, denylist and
  control-type checks still run first.
- `ValuePattern` (plain edits with no TextPattern) cannot be capped: the value
  enters host memory whole, is refused above 100,000 units, and never crosses
  IPC.
- `FindText` support varies by app. Where it is missing the GetText path runs,
  under the same caps.
- A focused element more than 64 raw-view steps below its nearest window is
  refused as `denied`. Each step is one cross-process call.
- Caps count UTF-16 code units, and the copy says characters. Every anchor
  claim is an upper bound in characters; a delivery full of emoji counts double
  toward its own region cap.
- Many corrections are never observed: a dictation started within a second of
  the last paste, continuous hands-free sessions, or a correction made after
  85 s. That loses a lesson and nothing else.

## Alternatives rejected

- Let the webview name the expected field and check the app id in TypeScript:
  the first read had no identity, and the app check ran after the text crossed
  IPC.
- Let the webview hold the anchors and pass them back: a compromised webview
  could search for any string and read what follows it.
- Return the full field text and locate the span in TypeScript: up to 100,000
  units of a document crossed IPC up to six times per dictation.
- Record a target on every `write_text`: a UIA round trip on every paste for a
  feature that ships off, and a readable target for people who never turned it
  on.
- A separate command that takes the delivered text and arms a target: the
  webview could pass any needle; `write_text` already holds the text it pasted.
- Take the app id from the foreground window: focus can change between
  `GetForegroundWindow` and `GetFocusedElement`.
- Extend `get_foreground_context` with text: every routing and guard probe
  would carry document text it does not need.
- Fail open on the password check, as the guard does: the guard can only
  withhold text, while this read takes text out of the field, so an unknown
  answer must refuse.
- Keep `2 * delivered + 200` next to an empty anchor and soften the copy
  instead: the common case, a paste at the end of a chat box or an email body,
  would send a whole typed reply across IPC on every read.
- Refuse terminals by exe name only: a console window's client process can be
  any program.
- Default on: no consent moment exists before the first read, and the public
  brand document said Tironian does not read the screen.

## Consequences

- `write_text` gains an argument, so `bindings.gen.ts`, the text service and the
  cursor sink change with it.
- `Win32_System_Ole` joins the `windows` crate features (`SafeArrayGetLBound`,
  `SafeArrayGetUBound`, `SafeArrayGetElement`, `SafeArrayDestroy`;
  `Cargo.toml:65`). The class and window calls need no new feature.
- Electron, browser and some Win32 targets may expose a control type or pattern
  the gate refuses. That costs the person a lesson the learner could have taken,
  and nothing else.
- The brand document's "Reads your screen" row and roadmap bullet, and the
  STATUS roadmap line, are rewritten in the commit that lands this ADR, with a
  paragraph that states exactly what is read.
