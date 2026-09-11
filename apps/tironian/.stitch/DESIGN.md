---
name: Whispering
colors:
  background: "#FDFCFC"
  surface: "#FFFFFF"
  foreground: "#020618"
  muted: "#E9EDF1"
  mutedForeground: "#62748E"
  border: "#E2E8F0"
  primary: "#0F172B"
  primaryForeground: "#F8FAFC"
  destructive: "#E7000B"
  warning: "#E17100"
  success: "#48C850"
  ring: "#90A1B9"
  darkBackground: "#020618"
  darkSurface: "#0F172B"
  darkForeground: "#F8FAFC"
  darkMutedForeground: "#90A1B9"
  darkPrimary: "#E2E8F0"
fonts:
  sans: "Geist Variable"
  mono: "Geist Mono Variable"
radius: "0.625rem"
---

# Design System: Whispering

Source: `apps/whispering` on the shared `@epicenter/ui` layer (shadcn-svelte 1.x,
Vega preset, Tailwind v4). Extracted from source, not from a running build:
`apps/whispering` is intentionally broken post ADR-0227.

Authoritative token files:

- `packages/ui/src/app.css` (the palette, in oklch)
- `packages/ui/src/styles/shadcn-base.css`, `style-vega.css`, `epicenter-overlay.css`
- `apps/tironian/src/app.css` (native audio element only)

## 1. Visual theme and atmosphere

A quiet single-column desktop utility. The screen is one narrow centered column
(`max-w-xl`, 36rem) inside a small Tauri window, so the design language is
vertical stacking and restraint rather than dashboard real estate. Light mode is
a barely warm off-white canvas (#FDFCFC) with pure white cards, so a card reads
as elevated without needing a border. Dark mode inverts to a deep blue-black
canvas (#020618) with slate-navy cards (#0F172B).

Neutrals are cool and slate-tinted throughout, never warm gray. There is no
brand accent color: the primary action is near-black ink, and the only saturated
colors in the system are functional states (destructive red while recording,
amber warning, green success). That absence is the design decision. A dictation
tool is used while looking at another application, so the screen has to stay
calm and legible at a glance rather than compete for attention.

Density is moderate: roughly five stacked blocks with a 1.25rem gap, generous
padding inside each, no scroll on the happy path.

## 2. Color palette and roles

### Primary foundation

- **Warm Paper** (#FDFCFC): page canvas, light mode. A hair off pure white so
  white cards read as raised.
- **Pure Surface** (#FFFFFF): card and container fill, light mode.
- **Midnight Canvas** (#020618): page canvas, dark mode.
- **Slate Navy Surface** (#0F172B): card fill, dark mode.
- **Hairline Border** (#E2E8F0): 1px structural lines, input borders. Dark mode
  uses white at 10 percent instead.

### Accent and interactive

- **Ink Primary** (#0F172B): the primary CTA fill and the record glyph tile.
  Deliberately achromatic. Dark mode flips this to **Pale Slate** (#E2E8F0) with
  dark ink text.
- **Selection Fill** (#E9EDF1): toggle-group selected item and ghost hover.
  Tuned 0.023 lightness below the shadcn default so a selected capture surface is
  visibly selected against the canvas.
- **Focus Ring** (#90A1B9): focus outline at 50 percent opacity.

### Typography and text hierarchy

- **Ink** (#020618): headings and primary text.
- **Steel** (#62748E): descriptions, metadata, shortcut hints, pipeline labels.
  Dark mode: **Mist** (#90A1B9).

### Functional states

- **Alert Red** (#E7000B): active recording. Used as a 10 percent tint fill with
  a full-strength glyph, plus a 25 percent ring on the card. Never a solid red block.
- **Amber** (#E17100): warning, capability notices.
- **Green** (#48C850): success, ready state.

Banned here: purple or neon accents, gradient CTAs, any second brand hue.

## 3. Typography rules

- **Display and body:** Geist Variable. One family for the whole UI. Even,
  product-tool grotesk. Chosen over a proprietary brand font, and Inter is not in
  the stack.
- **Mono:** Geist Mono Variable, for shortcut keycaps, timestamps, and durations.
- **Hierarchy:**
  - Page title: 1.875rem (`text-3xl`), semibold, tight tracking.
  - Page description: 1rem, Steel.
  - Section heading: 1rem, semibold.
  - Card action label: 1.125rem desktop / 1rem mobile, semibold, `leading-none`.
  - Card action description: 0.875rem desktop / 0.75rem mobile, medium, Steel.
  - Helper and hint lines: 0.875rem, Steel, centered.
- Hierarchy comes from weight and color, not size jumps. Nothing on this screen
  is larger than 1.875rem.

## 4. Component stylings

- **Buttons:** radius 0.625rem, flat, no glow. Primary is Ink fill with pale
  text. `outline` and `ghost` carry every secondary action. Setup actions on this
  screen are full width.
- **Cards:** `rounded-xl` (0.75rem), Pure Surface fill, `shadow-sm`, no border in
  light mode. The recording card raises to `shadow-md` plus a destructive ring at
  25 percent while active, and never changes height between idle and recording.
- **Record action row:** a 3.5rem to 4rem rounded tile holding a mic glyph (Ink
  fill) or a stop square (red tint fill), then a two-line label block, then a
  monospace keycap at the right edge. The tile never animates or meters: the live
  meter lives in the floating pill, a separate window.
- **Capture pipeline footer:** a bordered strip inside the same card, one row of
  small ghost buttons with 1rem icons, separated by a hairline top border. It is
  status plus quick change, not a settings panel.
- **Toggle group:** three equal segments (manual, voice activated, import),
  selected segment filled with Selection Fill. Icon plus label on desktop, icon
  only below `sm`.
- **Inputs:** label above, radius matched to buttons, focus ring in Focus Ring at
  50 percent. The inline API key field appears only in the not-ready state.
- **Drop zone:** 8rem to 9rem dashed bordered region, full width, for the import
  surface.
- **Keycaps:** `Kbd` at 1.75rem height, Selection Fill at 75 percent, mono, Steel.

## 5. Layout principles

- Centered single column, `max-w-xl`, `px-4`, `pt-8 pb-24`, vertically centered
  from `sm` up. The bottom padding clears a fixed bottom nav on narrow windows.
- Vertical rhythm is a 1.25rem gap between blocks, 4px base scale.
- Navigation is a vertical rail on wide windows and a bottom bar on narrow ones,
  carrying Home, Recordings, Recipes, Snippets, Settings.
- The breakpoint that matters is `sm` (640px): below it, labels drop to icons, the
  column tops out rather than centering, and the bottom nav appears.
- Touch targets stay at or above 44px on the record card and toggle segments.
- Centering is intentional here and overrides the usual asymmetric-hero rule.
  This is a one-action tool screen, not a marketing page.

## 6. Design system notes for Stitch generation

### Language to use

"Quiet desktop utility. Narrow centered single column in a small window. Cool
slate neutrals, off-white canvas, white elevated cards with soft shadows and no
borders. Achromatic near-black primary action. Red appears only while recording.
Geist typography, weight-driven hierarchy, nothing larger than 30px."

### Color references

Canvas #FDFCFC, surface #FFFFFF, ink #020618, steel #62748E, hairline #E2E8F0,
primary ink #0F172B, selection #E9EDF1, alert #E7000B, amber #E17100,
green #48C850. Dark mode: canvas #020618, surface #0F172B, text #F8FAFC,
steel #90A1B9.

### Component prompts

- "Elevated white card, 12px radius, soft shadow, no border, containing a 56px
  rounded ink tile with a microphone glyph, a two-line label block, and a
  monospace keyboard shortcut chip aligned right."
- "Three-segment toggle group, equal widths, selected segment filled with a soft
  cool gray, icon plus short label, full column width."
- "Hairline-separated footer strip inside a card: a single row of small ghost
  buttons with 16px icons showing microphone, transcription model, polish status,
  and capture behavior."

### Incremental iteration

Change one block per edit and keep the column width fixed. The states that must
survive every iteration: setup-required, ready with each of the three capture
surfaces, active recording, and latest-result present.
