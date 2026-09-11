# Navigation and settings layout: one spine, five groups

**Status**: Draft
**Type**: Organization (chrome, routes, and which screen owns which control)
**Scope**: `apps/whispering/src/routes/(app)/`
**Replaces**: `20260830T210000-navigation-and-surface-organization.md`, whose
rule this keeps and whose proposals 1, 2 and 4 this decides.

## Problem

A person on the Settings screen is looking at three navigation layers at once.

1. `(app)/+layout.svelte:79` renders `VerticalNav`, the collapsible left rail
   holding the six `NAV_ITEMS`.
2. `(config)/+layout.svelte:34` renders a 14-unit header carrying the wordmark
   *and* a live device selector, transcription selector and record button.
3. `settings/+layout.svelte:56` renders a second left column,
   `<aside class="lg:w-1/6"><SidebarNav /></aside>`, listing nine settings pages.

Two left menus and a control strip, for nine pages of which four are under 80
lines. The chrome is larger than the content it frames.

The same split produces a concrete duplication: the recording device is
selectable from three places, and one of them is a settings page.

- `(config)/+layout.svelte` renders `ManualDeviceSelector` / `VadDeviceSelector`
- `(app)/+page.svelte` renders the same two in the pipeline row
- `settings/recording/+page.svelte` renders `ManualSelectRecordingDevice` /
  `VadSelectRecordingDevice`, a second implementation of one setting

## The rule

Kept verbatim from the previous draft, because it is sound and was already
agreed:

- A **top-level section** is a thing you keep: a library of objects that
  accrues, that you browse, edit and reuse.
- **Settings** is how one machine behaves: a device, a key, a hotkey, a sound.
- Everything else is a **control**, and a control belongs on the screen where
  the work happens, not in a list of preferences.

One addition, which is what this document decides:

- **One left menu.** The rail is the only vertical navigation in the app. Any
  second level of navigation is horizontal, inside the content column, or it
  does not exist.

`apps/honeycrisp`, the reference app, already obeys this: flat `account/` and
`device/` routes, no settings nav at all.

## Decisions

### D1. The settings aside becomes a horizontal group strip

Delete `<aside>` from `settings/+layout.svelte` and turn `SidebarNav.svelte`
into a horizontal, scrollable strip above the content, still driven by the same
array. The rail keeps its job; the settings groups stop competing with it. A
strip survives all three widths the app already supports, which a second column
does not: the rail is icon-collapsed at medium and replaced by `BottomNav`
below 768px, where a `lg:w-1/6` aside stacks into a list of nine links above
every settings page.

### D2. Nine settings pages become five groups

| New group | Absorbs | Why |
| --- | --- | --- |
| Capture | `recording` + `sound` | Both answer "how this machine records": device policy, bitrate, and the sounds that mark start and stop. |
| Processing | `processing` | Unchanged. Where audio and text are processed, with the keys that implies. |
| Shortcuts | `shortcuts` | The page a new person needs first, and the only home of the global hotkey. Second in the strip, not fifth. |
| App rules | `apps` | Stays its own route. At 385 lines it is an editor over a list you author, and it is the one settings page that behaves like a library. |
| Account & data | `account` + `data` + `analytics` | Identity, what leaves the machine, and the bundle that moves it. |

Four of the nine pages are under 80 lines; merging them removes route files
rather than restyling them.

Deep links keep working: `/settings/recording` and `/settings/sound` both
resolve to Capture, and the anchor decides the scroll position.

### D3. The header stops carrying capture controls

`(config)/+layout.svelte` keeps the wordmark and nothing else. The recording
pill already owns stop and cancel on every route, and the global shortcut
already starts a capture from anywhere, so the header's selectors buy nothing
that is not already reachable while costing the app its third chrome layer.

### D4. The recording device has exactly one home

The pipeline row on Home owns it. `ManualSelectRecordingDevice.svelte` and
`VadSelectRecordingDevice.svelte` are deleted, and the Capture group keeps only
what is genuinely policy and not a live control: bitrate and the capture
behavior toggles.

A person deciding which microphone is live is looking at the record screen
while they decide.

### D5. Polish becomes a control, per the previous draft's proposal 1

`PolishStatusLink.svelte` currently reads the state and links to `/dictation`
to change it. It toggles `polishEnabled` in place instead, in the pipeline row
beside the device and transcription selectors. Dictation keeps what is a
library: instructions, dictionary, command mode.

## Before and after

```
before                                  after
(app)/                                  (app)/
  +layout      rail + content             +layout      rail + content
  +page        record screen              +page        record screen
  (config)/                               (config)/
    +layout    header + selectors           +layout    header, wordmark only
    recordings/                             recordings/
    dictation/                              dictation/
    recipes/                                recipes/
    snippets/                               snippets/
    settings/                               settings/
      +layout  title + ASIDE + content        +layout  title + STRIP + content
      +page             general               +page            capture
      recording/                              processing/
      sound/                                  shortcuts/
      processing/                             apps/
      shortcuts/                              account/
      apps/
      account/
      data/
      analytics/
```

Nine settings routes become five. Two left menus become one. Three device
selectors become one.

## Order

1. **D3 and D4 together.** They remove a duplicated control and a chrome layer,
   and they touch the fewest files. Do them first and the app is already better.
2. **D1.** Mechanical: one layout edit, one component rewritten as a strip.
3. **D2.** The merges, one group at a time, each its own commit.
4. **D5.** Independent of the rest; do it whenever `PolishStatusLink` is open.

## Not in scope

The record button pretends to be a gate it is not: `operations/recording.ts`
starts a capture without consulting `getTranscriptionReadiness`, so the global
shortcut records while the button is disabled. That is a correctness bug in the
operations layer, not a layout question, and it gets its own change.
