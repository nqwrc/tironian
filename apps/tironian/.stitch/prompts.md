# Stitch prompts: Whispering main screen, three redesigns

Enhanced with `stitch-utilities:enhance-prompt` against the design system in
`DESIGN.md` (extracted with `stitch-design:extract-design-md`) and the taste
rules from `stitch-utilities:taste-design`.

Shared design-system block. Per the generate-design skill, if the design system
is already registered at the Stitch project level with
`stitch-design:manage-design-system`, drop this block from the generation prompt
and send only the page structure.

```
DESIGN SYSTEM (REQUIRED):
- Platform: Web app rendered in a small desktop window, desktop-first, single centered column at 36rem max width
- Theme: Light with a dark counterpart, quiet, cool slate neutrals, no brand accent hue
- Background: Warm Paper (#FDFCFC). Dark: Midnight Canvas (#020618)
- Surface: Pure Surface (#FFFFFF), elevated by soft shadow, no border. Dark: Slate Navy (#0F172B)
- Primary action: Ink Primary (#0F172B) fill with Pale text (#F8FAFC), achromatic on purpose
- Selection fill: (#E9EDF1) for the selected segment of a toggle group and ghost hovers
- Text primary: Ink (#020618). Text secondary: Steel (#62748E)
- Hairline: (#E2E8F0) for 1px dividers and input borders
- Functional only: Alert Red (#E7000B) while recording, Amber (#E17100) warning, Green (#48C850) ready
- Typography: Geist Variable throughout, Geist Mono for shortcut keycaps and durations. Nothing larger than 30px. Hierarchy by weight and color, not size
- Radius: 10px on buttons and inputs, 12px on cards
- Motion: restrained. No pulsing record button, no meter on this screen. The live level meter lives in a separate floating window
- Banned: emoji, purple or neon accents, gradient text, glow shadows, pure black, fabricated metrics, three equal feature cards
```

---

## 1. Focus

One action, everything else demoted until asked for.

```
The main screen of a desktop dictation app, reduced to a single confident action. The screen should feel like a light switch, not a control panel: a person is looking at another application when they use it.

PAGE STRUCTURE:
1. Header: A 32px microphone illustration beside the wordmark "Whispering", left-aligned at the top of the column, with one line of Steel secondary text underneath reading "Press shortcut, speak, get text."
2. Primary action card: A full-width elevated white card, 12px radius, soft shadow, no border, minimum 96px tall. Inside, left to right: a 56px rounded Ink Primary tile holding a microphone glyph, then a two-line label block with "Start recording" in semibold 18px and "Default microphone, Whisper large-v3" in 14px Steel, then a monospace keyboard chip reading "Ctrl+Shift+Space" pinned to the right edge.
3. Surface chips: Inside the same card, along its top-right corner, three small ghost icon buttons for manual capture, voice activated capture, and file import. The current one carries the Selection Fill. No labels, tooltips only.
4. Collapsed pipeline row: A hairline-separated strip at the bottom of the same card. One line of Steel 13px text summarising the whole pipeline as "Default mic, Whisper large-v3, no polish, paste to active app", with a small chevron at the right that expands it into four labelled controls in place.
5. Last result strip: Below the card, a single-line borderless row: the first line of the most recent transcript truncated with an ellipsis, a relative timestamp in mono, and copy and delete icon buttons revealed on hover.
6. Footer hint: One centered 14px Steel line, "Your shortcut works from any app", with "Configure shortcuts" as an inline link.

SETUP-REQUIRED VARIANT: Replace only the primary action card with a card of the same size holding a section heading "Set up transcription", one labelled password input for an API key, a full-width Ink Primary "Save and continue" button, and a Steel link "Change provider, model, or endpoint in Privacy and Processing". Every other block stays exactly where it is, greyed to 40 percent opacity.
```

---

## 2. Console

The screen becomes the front door to the output, not just the input.

```
The main screen of a desktop dictation app arranged as a working session: capture at the top, the transcripts it produced directly underneath, ready to copy, rerun, or send onward.

PAGE STRUCTURE:
1. Header: A compact row with the "Whispering" wordmark on the left and, on the right, a small Green (#48C850) dot with the Steel label "Ready" plus a Steel count reading "12 today".
2. Capture bar: A full-width elevated white card, 12px radius, 72px tall, holding a 48px rounded Ink Primary tile with a microphone glyph, the label "Start recording" in semibold 16px, a three-segment toggle group at the right for manual, voice activated, and import with icons and short labels, and a monospace shortcut chip at the far right.
3. Pipeline strip: Immediately below the capture bar and visually attached to it, a hairline-topped row of four small ghost buttons, each an icon plus a short Steel value: microphone name, transcription model, polish recipe, delivery target.
4. Session feed: A vertical list of the last five transcripts, newest first. Each row is a borderless block separated by a hairline: a mono duration and relative time on the first line in Steel, the transcript text on up to two lines in 14px Ink, and a right-aligned cluster of icon buttons for copy, replay audio, rerun with a different recipe, and delete, at 40 percent opacity until the row is hovered. The newest row is expanded to show its full text.
5. Feed footer: A single left-aligned Steel link, "View all recordings".

EMPTY VARIANT: Replace the session feed with a composed empty state, not a line of text: a faint hairline-outlined placeholder row at 25 percent opacity with the caption "Transcripts land here. Press the shortcut from any app."

SETUP-REQUIRED VARIANT: Replace the capture bar and pipeline strip with a single card containing "Set up transcription", one labelled API key input, and a full-width Ink Primary button. Keep the header status dot but turn it Amber (#E17100) with the label "Setup needed". The session feed shows its empty state below.
```

---

## 3. Pipeline

The screen is drawn as the path audio takes, so setup and steady state are one layout.

```
The main screen of a desktop dictation app drawn as the path a recording takes. The person can see, in one glance, where their voice goes and which stage is not ready yet. Onboarding and normal use are the same layout, not two different screens.

PAGE STRUCTURE:
1. Header: The "Whispering" wordmark, left-aligned, with one Steel line underneath, "Speech in, text where you want it."
2. Stage stack: Four stacked full-width rows, connected by a 2px vertical hairline running down their left edge through a small node marker on each row, reading top to bottom as one continuous path.
   - Stage 1, Capture: a 40px rounded Ink tile with a microphone glyph, the label "Capture" in semibold 15px, the current value "Default microphone, manual" in 13px Steel, and a three-segment toggle group at the right for manual, voice activated, and import.
   - Stage 2, Transcribe: the label "Transcribe", the value "Whisper large-v3, Groq", and a small ghost "Change" button at the right.
   - Stage 3, Polish: the label "Polish", the value "Off", and a ghost "Add a recipe" button.
   - Stage 4, Deliver: the label "Deliver", the value "Paste into the active app", and a ghost "Change" button.
   Each row carries a state marker at its right edge: a small Green (#48C850) check when configured, an Amber (#E17100) ring when it needs attention, a Steel dash when it is deliberately off.
3. Terminus action: Below the last stage and attached to the same left rail, a full-width Ink Primary button, 56px tall, reading "Start recording", with a monospace shortcut chip inside it at the right edge. When any stage is unresolved the button is disabled at 40 percent opacity and its label reads "Finish setup to record".
4. Inline stage resolution: When a stage needs attention, that row expands in place to hold its own control, for example an API key input under Transcribe with a "Save" button, rather than routing the person to a separate settings screen. All other rows stay collapsed.
5. Output row: Below the button, one hairline-separated row showing the most recent transcript on a single truncated line with a mono timestamp and copy and delete icon buttons.

Do not use cards for the stages. Use the connected rail and hairline separators so the stack reads as one object.
```

---

## Not generated

The Stitch MCP server is not connected in this session, so
`generate_screen_from_text`, `edit_screens`, `list_projects`, and
`create_project` were unavailable. These prompts are ready to fire once it is;
the setup flow is documented at the Stitch MCP setup page linked from the
`google-labs-code/stitch-skills` marketplace README.
