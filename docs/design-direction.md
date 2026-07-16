# StreetLens Design Direction (rev 5, sealed 2026-07-16)

Binding for all UI work. rev 5 is the **Field Manifesto**: numbered bold-black theses on academic-paper bones, one loud flash-pink signal, the live map as a cross-referenced FIGURE 1. Supersedes rev 4 (survey-instrument / road-yellow / pine). Deviations require Conductor approval; sealed decisions are not reopened.

## Identity

A civic instrument published as a document. The register is Linear/Dogme-declarative theses (numbered, bold, centered) sitting on academic-paper structure: an abstract, numbered sections, a sidenote/citation apparatus, hairline rules, and the live interactive map presented as `FIGURE 1`. Startup conversion lives inside the document's own vocabulary (a CTA closes a thesis; the product is numbered figures; proof is the live map plus real pilot stats). Dark mode is the same document as a letterpress negative (inverted paper). The rev-4 identity (cool concrete-paper, road-marking yellow, pine primary, contour texture) is retired.

## Founder rulings (sealed)

1. **Direction: Field Manifesto.** Numbered bold-black centered theses on paper bones. Abstract, numbered sections, sidenotes, hairline rules, the map as FIGURE 1.
2. **Type: Space Grotesk 700 display / Newsreader serif body / IBM Plex Mono instrument.** Serif NEVER touches a headline (hard rule).
3. **Dark mode: inverted paper.** Warm near-black ground, creme ink. Auto via `prefers-color-scheme`.
4. **Accent: FLASH PINK, signal-only.** One loud pink on an otherwise creme/white/black document. Road-yellow retired. Pink appears ONLY as: CTA fill, active state, link underline, margin/figure tick, the LIVE dot. Never decorative washes, gradients, glows, big blocks, or body text.

## Palette

Every value is AA-verified numerically (see the u13 report for the full computed table). Ratios below are the WCAG relative-contrast ratios of the text/graphic role against the named ground(s). Light grounds: `paper #F3F1E9`, `paper-white #FBFAF6`, `paper-sunken #E9E6DB`. Dark grounds: `paper #14120C`, `paper-white #1E1B14`, `paper-sunken #0D0B07`.

### Light — "paper" (default)

| Token | Hex | Role | AA (paper / white / sunken) |
|---|---|---|---|
| `--paper` | `#F3F1E9` | Page ground (cool restrained creme, not honey) | ground |
| `--paper-white` | `#FBFAF6` | Plates, cards, long-reading blocks | ground |
| `--paper-sunken` | `#E9E6DB` | Interstitial bands, sidenote lane, table zebra | ground |
| `--ink` | `#191510` | Warm near-black body | 16.06 / 17.39 / 14.54 |
| `--ink-display` | `#0C0A06` | Bold-black headlines, truest black | 17.49 / 18.94 / 15.83 |
| `--ink-muted` | `#6A6355` | Captions, meta | 5.26 / 5.70 / 4.76 |
| `--ink-faint` | `#938B7B` | Ticks, disabled — **graphic/large only** (sub-AA by design) | 2.99 / 3.23 / 2.70 |
| `--hairline` | `#DAD5C7` | 1px rules, figure plate borders | graphic |
| `--hairline-strong` | `#B7B0A0` | Stronger dividers, active borders | graphic |
| `--accent` | `#F0268C` | FLASH PINK graphic signal (fill/active/tick/underline) | graphic |
| `--accent-strong` | `#CF1273` | Press/hover, tick strokes | graphic |
| `--accent-text` | `#A80D5F` | Deep magenta for accent TEXT on paper | 6.43 / 6.96 / 5.82 |
| `--accent-fg` | `#0C0A06` | Fixed dark LABEL on pink fills (both themes) | 5.05 on `--accent` |
| `--amber` | `#7A5A0E` | Status: pending (admin) | 5.63 / 6.10 / 5.10 |
| `--clay` | `#B23A22` | Status: destructive (admin) | 5.27 / 5.71 / 4.77 |
| `--terracotta` | `#E07A3F` | **DATA ONLY** (score ramps / geometry viz) | banned from chrome |
| `--ring` | `#191510` | Focus ring = ink | 16.06 (≥3 graphic) |

### Dark — "inverted paper"

| Token | Hex | Role | AA (paper / white / sunken) |
|---|---|---|---|
| `--paper` | `#14120C` | Warm near-black ground | ground |
| `--paper-white` | `#1E1B14` | Elevated plates / reading | ground |
| `--paper-sunken` | `#0D0B07` | Deepest interstitial | ground |
| `--ink` | `#F1EEE3` | Creme text (the negative) | 16.12 / 14.79 / 16.93 |
| `--ink-display` | `#FBF9F0` | Brightest headline ink | 17.75 / 16.29 / 18.64 |
| `--ink-muted` | `#A69E8C` | Captions, meta | 7.04 / 6.46 / 7.39 |
| `--ink-faint` | `#6E6656` | Ticks, disabled — graphic/large only | graphic |
| `--hairline` | `#33302A` | 1px rules | graphic |
| `--hairline-strong` | `#4C483F` | Stronger dividers | graphic |
| `--accent` | `#FF4FA3` | Flash pink on near-black | graphic |
| `--accent-strong` | `#FF77B8` | Press/hover | graphic |
| `--accent-text` | `#FF6FB0` | Pink as text on dark | 7.27 / 6.67 / 7.63 |
| `--accent-fg` | `#0C0A06` | Fixed dark label on pink fills | 6.50 on `--accent` |
| `--amber` | `#E0A93A` | Status: pending | 8.83 / 8.11 / 9.27 |
| `--clay` | `#F0876B` | Status: destructive | 7.47 / 6.86 / 7.85 |
| `--terracotta` | `#EF8F56` | DATA ONLY | banned from chrome |
| `--ring` | `#F1EEE3` | Focus ring = creme ink | graphic |

### Button fills (both themes)

- **Primary** = ink fill / paper text: `bg-ink-display text-surface`. Light 18.94:1, dark 17.75:1. (Button variant key stays `pine` for API stability; brand pine is retired.)
- **Accent** = pink fill / fixed dark label: `bg-accent text-accent-fg`. Light 5.05:1, dark 6.50:1. Hover lightens via opacity (darkening to `--accent-strong` would drop the dark label below AA: `#0C0A06` on `#CF1273` = 3.76:1).

### Retirements & holdovers

- **Road-yellow (`#E8C51C` family) retired everywhere.** **Pine retired as brand-primary**; primary chrome goes ink (fill = ink-display, text = paper) with pink as THE signal CTA. `--pine`/`--pine-strong` remain defined as an INTERIM ink hold (light: ink/ink-display; dark: creme/bright-creme) only so un-reskinned components still build; u14/u15 remove the last pine references (`ThreeDToggle`, contribute PRIMARY_BTN, `ring-pine`).
- **Terracotta stays DATA-ONLY** (draw trace, ramp mirrors). Hard ban from chrome.
- **Data ramps SEALED** (`mapConfig.ts` RAMP / BINS / COMMUNITY_CASING / widths + the render-script mirror): untouched; they coexist inside figures/legends only. Admin `--amber`/`--clay` are AA-tuned status tokens (data/status semantics), not a chrome accent.
- **Shadows near-flat.** `--shadow-panel` almost imperceptible (`0 1px 2px rgba(25,21,16,0.06)` light); `--shadow-popover` kept functional where layering demands it (map app).
- **Radii 2/4/6px** (`--radius-chip 2` / `--radius-panel 4` / `--radius-primary 6`). Plates are square-ish; big radius reads SaaS.
- **Glass retires on flat paper.** Permitted ONLY over live map tiles (data panels floating on tiles). `--glass-*` retuned to paper tints (`rgba(251,250,246,0.80)` light / `rgba(20,18,12,0.72)` dark).

### Token strategy (implementation note for u14/u15)

The rev-4 token names components already consume (`--surface-base/elevated/sunken`, `--ink`, `--neutral-strong/neutral/soft`, `--border`/`--border-strong`, `--pine`/`--pine-strong`, `--accent*`, `--ring`) are **kept and re-valued**, aliased via `var()` onto the rev-5 vocabulary to minimize churn. Prefer the rev-5 names for new work: `bg-paper`/`bg-paper-white`/`bg-paper-sunken`, `text-ink-display`/`text-ink-muted`/`text-ink-faint`, `border-hairline`/`border-hairline-strong`, `text-accent-fg`, `text-amber`/`text-clay`. Legacy → rev-5 mapping: `surface-*`→`paper*`, `neutral-strong`→`ink-muted`, `neutral`→`ink-faint`, `neutral-soft`/`border`→`hairline`, `border-strong`→`hairline-strong`.

## Type system

Faces via `next/font/google`: **Space Grotesk** (`--font-display` AND `--font-sans` for UI chrome), **Newsreader** (`--font-serif`, weights 400/500 + italics, `opsz` auto — landing/prose voice), **IBM Plex Mono** (`--font-mono`, instrument). Utility `font-serif` is exposed; serif is not applied to any surface until u15.

| Role | Face/weight | Size (desktop) | Tracking | Leading | Align |
|---|---|---|---|---|---|
| Thesis H1 | Space Grotesk 700, `--ink-display` | `clamp(2.5rem,6vw,5rem)` | -0.03em | 1.02–1.05 | centered |
| Section H2 | Space Grotesk 700 | 36–44px | -0.02em | 1.1 | centered |
| H3 | Space Grotesk 600 | 24–28px | -0.015em | 1.2 | — |
| Eyebrow/kicker | Plex Mono 500 CAPS | 12px | +0.12em | 1.4 | above headline, `--ink-muted` |
| Manifesto body | Newsreader 400 | 19–20px | 0 | 1.6–1.7 | left, 68ch column |
| Abstract/lead | Newsreader 400 italic | 21–22px | 0 | 1.5 | centered |
| Caption/sidenote | Plex Mono or Newsreader | 13–14px | +0.02em (mono) | 1.35 | left |
| FIGURE label | Plex Mono 500 CAPS | 11–12px | +0.08em | — | `--ink-muted`, period after number ("FIGURE 1.") |
| Numerics | Plex Mono tabular | — | — | — | — |

Discipline: bold reads via SIZE + negative tracking, never weight past 700. Eyebrows are the only positive-tracked uppercase element. App/admin UI chrome stays Space Grotesk + mono — serif is a landing/prose voice, not a UI voice, and never a headline.

## Layout (landing, u15)

Distill-style centered bands: `text` ~68ch/680px (all prose + headlines) · `outset` ~840px · `page` ~1080px (wide figures/tables) · `screen` full-bleed (map figure, closing band) · `gutter` right sidenote lane ~200–260px at ≥1180px. Vertical rhythm: 8px base, 96–120px between sections, a column-width 1px `--hairline` rule between sections. Numbered sections `01/02/03…` in mono. Vocabulary: centered italic abstract up top · sparing epigraphs · sidenotes with mono superscript counters (collapse to inline tap-reveal on mobile) · GroundingSection's hairline `<dl>` stays the canonical References block · at most ONE newthought/dropcap on the whole page, or none.

## The map as FIGURE 1 (u15)

Live, interactive, matted: paper ground → 1px `--hairline` border → 8–16px `--paper` mat inset → tiles (tiles never touch the border). Corners ≤4px, no/near-no shadow. Bounded aspect (3:2 or 16:10 desktop; taller on phone), NOT full-viewport. Caption block below, left-aligned: mono `FIGURE 1.` → Space Grotesk 700 claim → Newsreader support → mono source line (`Source: StreetLens field audits · n=… · retrieved <date>`, hairline above). One quiet mono affordance line (`↔ drag · scroll to zoom · tap a segment`). LIVE dot in `--accent` + mono timestamp. MapLibre controls minimal monochrome; attribution a tiny mono data-source line. Cross-reference the figure from prose. Product shots elsewhere become Figure 2/3 with the same plate treatment.

## Texture

Flat paper + hairlines carry ALL structure. The tiled `.contour-field` motif is retired from every surface (the class remains as a no-op). Body micro-grain removed. Contour may return as at most ONE deliberate low-opacity moment (e.g. behind the closing inverted band) — u15's call, or drop entirely.

## Depth

Near-flat. Max 3 elevation levels: base, floating panel (`--shadow-panel`, almost imperceptible), popover/modal (`--shadow-popover`, functional, map app only). Every interactive element carries a non-shadow affordance: a 1px hairline at ≥3:1 and/or a background step. All text ≥4.5:1 (AA). No glassmorphism on flat surfaces (map-tile survivors only).

## Iconography

Phosphor or Lucide at one consistent stroke weight. Zero emoji in UI.

## Score ramps (SEALED — data meaning, never chrome)

One active layer at a time, colorblind-safe, plus a line-WIDTH channel. Overall teal→amber→clay (`#0E7C66`→`#E8B84B`→`#C0472B`, high = good); Accessibility Cividis blue; Drainage Viridis blue-teal→dull yellow; Shade canopy green→pale bone; community casing neutral grey dashed. Legend always visible with explicit value bins; never color-only encoding. These live in `mapConfig.ts` and its `scripts/render-map-images.mjs` mirror and MUST NOT change.

## Basemap (u14)

Retint `BASEMAP`/`HILLSHADE`/`BUILDINGS` to paper grounds (label-stripped, data layer dominates), then re-run `npm run render:maps` so static plates match the live map. RAMP stays sealed.

## rev-5 BAN LIST (additive; all rev-4 bans hold except superseded color rules)

- Serif in any headline/display slot; no high-contrast display serifs anywhere (Fraunces, Playfair, DM Serif, Libre Caslon, Cormorant).
- Honey/golden creme; reading text on saturated creme.
- Drop-shadow card grids as layout (hairlines instead). Rounded-xl/2xl figure frames.
- Badge-pill + two-CTA centered hero.
- Tiled decorative pattern behind text.
- Terracotta or any data-ramp hue in chrome. Road-yellow anywhere (retired).
- Pink as decoration: washes, gradients, glows, big pink blocks, pink body text. Pink is a SIGNAL.
- Glassmorphism anywhere except over live map tiles.
- (rev-4 holds) Purple/indigo gradients · gradient-mesh/aurora backgrounds · decorative glows on chrome · colored left-border cards · Inter-only typography · emoji as headers/icons · identical icon-top 3-card feature rows · uniform rounded-xl everywhere · stat-banner filler rows · meaningless status dots · rainbow accent tabs · deep card nesting · fake testimonials/logo clouds · sub-AA gray body text · unthemed default shadcn · full-saturation neon palettes.

## Copy register (u15; EN + ES parity, array lengths equal)

Declarative, imperative, parallel, plain. Eyebrows mono caps; theses bold black centered. ES keeps the parallel/imperative cadence, not literal word-for-word. NO em dashes in new copy (house rule): use periods, colons, semicolons, parentheses per grammar.

## Changelog

- rev 2 (2026-07-15): Space Grotesk replaces Bricolage Grotesque + Hanken Grotesk app-wide, founder direction.
- rev 3 (2026-07-15): Ban-list glassmorphism narrowed to imagery-backed surfaces only (founder direction).
- rev 4 (2026-07-15): Brand evolution off the AI-slop cluster (cream + serif/display + terracotta). Cool concrete-paper grounds, road-marking yellow accent, terracotta demoted to data-only, asphalt green-black dark mode, Plex Mono promoted to instrument voice, topographic contour texture.
- rev 5 (2026-07-16): **Field Manifesto.** Paper/ink/flash-pink retoken across both themes (light paper / dark inverted-paper); road-yellow and pine-as-brand retired (pine held to interim ink for u14/u15 cleanup). Newsreader serif wired as the prose voice (never a headline); Space Grotesk 700 stays display, Plex Mono stays instrument. Contour texture and body grain retired for flat paper + hairlines. Radii → 2/4/6, shadows near-flat, glass restricted to live-map-tile survivors, `--ring` = ink. Admin `--amber`/`--clay` promoted as AA status tokens; `--accent-fg` added as the fixed dark label for pink fills. All values AA-verified numerically (u13 report). Landing re-layout to centered manifesto bands, Hero→FIGURE 1, and EN+ES copy rewrite are u15; map/admin/contribute reskin + basemap retint are u14.
