# ADR-0245: One window; model settings live in the dictation app

- Status: Accepted
- Date: 2026-09-13
- Supersedes: the two-window split recorded as ADR-0180, ADR-0189 and ADR-0209,
  which no longer ship in this repository; their rules survived only in code
  comments, tests and `apps/desktop/AGENTS.md`.

## Context

Tironian shipped two windows: the dictation app, and a Home window titled
"Model settings" that did one thing, administer the one active local
transcription model. Home was a leftover of an upstream multi-app shell. In a
single-app product it meant a person choosing a model was sent to a second
window and then sent back, and the dictation app could only say "open model
settings" because it was not allowed to know which model was active.

The split was enforced as wiring: the model administration commands were
granted to the `home` window label alone, a `launch_application` verb let Home
open the dictation window, and the dictation window could only ask the host to
open Home (`open_home`).

The owner decided the app never opens a second window for any surface.

## Decision

1. There is one application window, `dictation`. The Home window, its build,
   its Bun route, its window table entry, `open_home`, `launch_application`
   and the tray's "Model settings" item are removed.
2. Model administration moves into the dictation app's Settings, under
   Privacy & Processing, next to the on-device transcription route it
   configures. The `dictation` window is granted the model administration
   commands: list, download, cancel, delete, get and set the active model, get
   and set the unload policy.
3. The invariant worth keeping from the old boundary stays: a transcription
   request never names a model. `TranscriptionHints` has no model field, and
   the one active model changes only through the explicit administration
   commands. Choosing a model is a settings act, not a per-request argument.
4. The app-window capability (`trusted-app-windows-*`), which describes what
   the public `@tironian/app` client may call, does not gain the
   administration commands. They are granted by the dictation app's own native
   capability.

The floating recording pill is a separate always-on-top webview so it can show
state over other applications. It is not a surface a person opens, and it is
not changed by this decision.

## Consequences

- One capability file fewer per build, and one webview fewer in memory.
- The dictation app can name the active model in its own UI, which the old
  boundary forbade.
- Deep links resolve only `tironian://app/dictation`; `tironian://app/home`
  is refused like any unknown app.
- Home was a single-file build that inlined its fonts as `data:` URLs, which
  is why the host CSP admitted `font-src data:`. The dictation build serves
  its fonts as files, so the directive is removed with Home.
