---
name: Fintrack
description: A calm, precise dark dashboard for self-directed investors — amber on near-black.
colors:
  signal-amber: "oklch(0.72 0.14 74)"
  near-black-bg: "oklch(0.08 0 0)"
  panel-surface: "oklch(0.12 0 0)"
  popover-surface: "oklch(0.14 0 0)"
  sidebar-surface: "oklch(0.105 0 0)"
  ink: "oklch(0.94 0.005 74)"
  muted-ink: "oklch(0.64 0.008 74)"
  emerald-gain: "oklch(0.72 0.15 152)"
  ruby-loss: "oklch(0.66 0.19 25)"
  steel: "oklch(0.64 0.07 240)"
  secondary-surface: "oklch(0.17 0 0)"
  accent-surface: "oklch(0.16 0 0)"
  border: "oklch(0.20 0 0)"
typography:
  display:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.04em"
  numeric:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  sm: "2px"
  md: "3px"
  lg: "4px"
  pill: "9999px"
spacing:
  panel: "16px"
  stack: "20px"
  gutter: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.near-black-bg}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  panel:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.near-black-bg}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  nav-tab-active:
    backgroundColor: "{colors.accent-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "6px 12px"
---

# Design System: Fintrack

## 1. Overview

**Creative North Star: "The Midnight Trading Desk"**

Fintrack is a calm, dark desk lit by a single warm lamp. The surface is near-black (`oklch(0.08 0 0)`); the only warm light in the room is Signal Amber, used the way a desk lamp pools light over the work that matters. Everything else recedes into graphite. It is an after-hours environment: focused, quiet, and exact, where a glance tells you where you stand and nothing on the screen is fighting for attention.

The system is dense where density is signal and empty everywhere else. Figures are set in monospace so columns align and the eye can scan a ledger without friction; prose and headings are set in a humanist sans so the chrome stays human. Depth comes from tonal layering, not shadow: background, panel, popover, and sidebar each sit a few lightness steps apart, separated by hairline `oklch(0.20 0 0)` borders. The result reads as machined, not decorated.

What this explicitly rejects: Robinhood-style gamification (no confetti, streaks, or dopamine theater), generic bank-template blandness (this has a point of view), and Mint-style consumer pastels (color is semantic, never cheerful filler). Dense, professional information design is welcome; the goal is precision without the clutter, not a dumbed-down toy.

**Key Characteristics:**
- Near-black surface with a single warm accent — amber as the only light source
- Monospace for every number, humanist sans for every word
- Flat by default: depth from tonal layers + 1px borders, not shadows
- Semantic color only — amber (brand), emerald (gain), ruby (loss); nothing decorative
- WCAG AA contrast, tuned for one intended environment (dark)

## 2. Colors

A graphite-on-near-black ramp with exactly one warm accent and two semantic signals; saturation is rationed so the rare colored pixel always means something.

### Primary
- **Signal Amber** (`oklch(0.72 0.14 74)`): The brand's only warm light. Brand wordmark, primary buttons, active/selected states, focus rings, key chart lines. Used sparingly so its presence reads as "look here."

### Secondary
- **Emerald Gain** (`oklch(0.72 0.15 152)`): Reserved exclusively for positive change — gains, up-moves, beats. Never decorative.
- **Ruby Loss** (`oklch(0.66 0.19 25)`): Reserved exclusively for negative change — losses, down-moves, misses, high-impact warnings.

### Tertiary
- **Steel** (`oklch(0.64 0.07 240)`): A cool counterweight for non-semantic links and secondary data series (e.g. macro/calendar accents) where amber/emerald/ruby would imply a meaning they don't carry.

### Neutral
- **Near-Black** (`oklch(0.08 0 0)`): The desk. App background and the text color that sits on amber.
- **Sidebar Graphite** (`oklch(0.105 0 0)`): Top nav / sidebar surface, a hair above background.
- **Panel Surface** (`oklch(0.12 0 0)`): Cards and panels.
- **Popover Surface** (`oklch(0.14 0 0)`): Dropdowns, menus, tooltips — the top tonal layer.
- **Ink** (`oklch(0.94 0.005 74)`): Primary text, faintly warm.
- **Muted Ink** (`oklch(0.64 0.008 74)`): Secondary text and labels; verified ≥4.5:1 on panel surface.
- **Hairline Border** (`oklch(0.20 0 0)`): The 1px lines that do the structural work shadows would do elsewhere.

### Named Rules
**The Single Lamp Rule.** Signal Amber lights ≤10% of any screen. It marks the brand, the active state, and the one thing the user should act on — never a decoration, never a second time for emphasis. If two amber things compete, one of them is wrong.

**The Earned Color Rule.** Emerald and ruby are forbidden except to encode gain and loss. A green that doesn't mean "up" or a red that doesn't mean "down" breaks the instrument.

## 3. Typography

**Display / Numeric Font:** Geist Mono (with ui-monospace, monospace)
**Body / Headline Font:** Geist Sans (with system-ui, sans-serif)

**Character:** A two-family system split by job, not by decoration: humanist sans for language, monospace for quantity. Tabular mono keeps every price, percent, and ledger column aligned; the sans keeps headings and prose from feeling like a terminal dump. Stylistic sets `ss01`, `cv01`, `cv11` are enabled globally for a slightly more geometric, modern cut.

### Hierarchy
- **Display** (Geist Mono, 500, 1.5rem / 24px, line-height 1): The big numbers — KPI values, account totals, the figure you came to read.
- **Headline** (Geist Sans, 500, 1.125rem / 18px, -0.01em): Page and section titles ("Futures", "Upcoming Events").
- **Body** (Geist Sans, 400, 0.875rem / 14px): Holding names, descriptions, news, copy. Cap measure at 65–75ch.
- **Label** (Geist Sans, 500, 0.75rem / 12px, +0.04em, often uppercase): Panel headers, column heads, eyebrow labels. ≤4 words.
- **Numeric** (Geist Mono, 400, 0.875rem / 14px): Every inline figure in tables and lists — prices, %, shares, changes.

### Named Rules
**The Mono-for-Numbers Rule.** Every quantity is set in Geist Mono, every word in Geist Sans. A price in a proportional font or a sentence in mono is always a mistake. The split is the system.

## 4. Elevation

Flat by default. Fintrack conveys depth through **tonal layering and 1px borders**, not drop shadows. Four near-black lightness steps — background `0.08` → sidebar `0.105` → panel `0.12` → popover `0.14` — stack like sheets of dark paper, each separated by a hairline `oklch(0.20 0 0)` border. A surface at rest never casts a shadow; that's what keeps the desk looking machined rather than soft.

### Shadow Vocabulary
- **Overlay lift** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.5)`, i.e. Tailwind `shadow-lg`): Used **only** on floating overlays that leave the document flow — dropdown menus, the profile popover. Never on cards or static panels.

### Named Rules
**The Flat-Desk Rule.** Panels and cards are flat and borderless-shadow at rest. Shadow appears only when an element physically floats above the page (a menu, a popover). If a card has a shadow, delete it and add a tonal step or a border instead.

## 5. Components

### Buttons
- **Shape:** Gently squared (4px radius, `rounded-lg` → `--radius-lg`). Compact: 32px default height (`h-8`), 10px horizontal padding.
- **Primary:** Signal Amber background, near-black text. Hover drops to 80% amber. The page's single call to action.
- **Hover / Focus:** All transitions ~150ms. Focus shows a 3px `ring-ring/50` amber ring plus border shift; active nudges down 1px (`translate-y-px`).
- **Outline / Secondary / Ghost:** Outline = `border` on transparent, hover fills `muted`. Ghost = no chrome until hover fills `muted` with `muted-ink` text. Used for low-emphasis and icon actions.
- **Destructive:** Tinted, not solid — `destructive/10` background with destructive text. Quiet even when dangerous.

### Chips / Toggles
- **Style:** Small bordered pills (filter chips on Calendar, Grid/Treemap and timeframe toggles on Futures, BUY/SELL on Paper). Border + faint tinted fill when active, transparent when idle.
- **State:** Active = colored border + `accent-surface` fill + ink text; idle = hairline border + muted-ink. Semantic toggles (BUY/SELL) borrow emerald/ruby for their active state.

### Cards / Containers (Panels)
- **Corner Style:** 3px radius (`rounded-md`).
- **Background:** Panel Surface (`oklch(0.12 0 0)`) on the near-black desk.
- **Shadow Strategy:** None — see Elevation. Separation is the `0.12` vs `0.08` tonal step plus a 1px border.
- **Border:** 1px Hairline Border (`oklch(0.20 0 0)`).
- **Internal Padding:** 16px (`p-4`); a small uppercase label header sits 12px above the content.

### Inputs / Fields
- **Style:** 32px tall, transparent background, 1px `input` border, 4px radius. Mono for numeric inputs (symbol/shares on the Paper ticket).
- **Focus:** Border shifts to amber `ring` + a 3px `ring-ring/50` glow. No layout shift.
- **Error / Disabled:** Error = destructive border + ring; disabled = 50% opacity, no pointer events.

### Navigation
- **Style:** A 48px top bar on the sidebar-graphite surface. Amber lowercase `fintrack` wordmark, then a row of text tabs.
- **States:** Active tab = `accent-surface` fill + ink text; idle = muted-ink, hover fills `accent/60` and lifts text to ink. Right side carries a sync-time button and a circular amber-initial avatar that opens the profile/settings popover.

### Heatmap Tile (Signature Component)
The Futures grid's core unit: a small bordered tile whose **background alpha scales with move magnitude** and whose **hue is emerald (up) or ruby (down)**. A header gradient legend maps the scale; in Treemap view the same encoding drives tile *area*. This is the clearest expression of the Earned Color Rule — color is pure data.

## 6. Do's and Don'ts

### Do:
- **Do** set every number in Geist Mono and every word in Geist Sans. Tabular figures are why columns line up.
- **Do** keep Signal Amber under ~10% of any screen — brand, active state, primary action, key chart line, and nothing else.
- **Do** reserve emerald strictly for gain and ruby strictly for loss; encode the same meaning redundantly (sign, value, label) so it survives color blindness.
- **Do** build depth with tonal steps (`0.08`/`0.105`/`0.12`/`0.14`) and 1px `oklch(0.20 0 0)` borders.
- **Do** give every transition a ~150ms ease and a `prefers-reduced-motion` fallback.
- **Do** verify body text ≥4.5:1 (muted-ink on panel passes; lighter grays don't).

### Don't:
- **Don't** gamify — no confetti, streaks, progress-bait, or celebratory animation. This is not Robinhood.
- **Don't** drift toward generic bank-template blandness or Mint-style pastels; color is semantic, never decorative cheer.
- **Don't** put a drop shadow on a card or panel. Shadows belong only to floating overlays (menus, popovers).
- **Don't** use amber, emerald, or ruby for anything that doesn't carry their meaning. A green that isn't "up" breaks the instrument.
- **Don't** set prices or percents in a proportional font, or run sentences in mono.
- **Don't** introduce a light mode or warm-tinted near-white surface; Fintrack is dark by design and its contrast is tuned for that one room.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe; use a full border or a tonal fill.
