# StreetLens Design Direction (rev 6, sealed 2026-07-16)

Binding for all UI work. rev 6 is the **Zen Instrument**: the same numbered civic-manifesto document as rev 5, re-valued to pure black-and-white zen (Japanese-zen meets Notion) with one loud flash-pink signal. The type system, figure/caption vocabulary, sidenote apparatus, honesty rules, mobile law, and most of the ban list carry over from rev 5 unchanged; the palette goes neutral, glass becomes true backdrop-blur (over map tiles only), and flat cards lift on zen-soft diffuse shadows. Supersedes rev 5's creme-paper palette and shadow family. Deviations require Conductor approval; sealed decisions are not reopened.

## Identity

A civic instrument published as a document, now rendered in pure black and white. The register is unchanged: Linear/Dogme-declarative theses (numbered, bold) on structured bones (an abstract, numbered sections, a sidenote/citation apparatus, hairline rules) with the live interactive map presented as `FIGURE 1`. What changes in rev 6 is the surface: warm creme-paper grounds and warm near-black ink are retired for a soft-white page with pure-black ink (light) and a near-black page with pure-white ink (dark). The world is grayscale; the only strong chroma on the page are the sealed data ramps and the single flash-pink signal. Depth reads through zen-soft diffuse shadows on flat cards and true glass over the live map. The register is "zen instrument": quiet, precise, high-contrast, a little glassy, never loud except where a signal or a datum earns it.

## Founder rulings (sealed)

1. **Palette: pure black and white + flash pink.** All warm/creme tint retired. Neutral grayscale only. Light: soft-white page, black ink. Dark: near-black page, white ink. Pink is the single accent, signal-only (CTA, active, LIVE, links), same discipline as rev 5.
2. **Type unchanged.** Space Grotesk 700 display / Newsreader serif body / IBM Plex Mono instrument. Serif NEVER touches a headline (hard rule).
3. **Glass + soft-neumorphic, zen discipline.** True glass (backdrop-blur) panels ONLY over the live map tiles (hero embed + full platform map). On flat white/black grounds: NO backdrop-blur; cards are plate-white / plate-black with soft diffuse zen-soft shadows (large radius, very low alpha) and hairline borders. Never stacked glass; never glass-on-flat; never heavy classic neumorphism (inset emboss/deboss).
4. **Accent: FLASH PINK, signal-only.** One loud pink on an otherwise white/black document. Pink appears ONLY as: CTA fill, active state, link underline, margin/figure tick, the LIVE dot. Never decorative washes, gradients, glows, big blocks, or body text.
5. **Dark mode: the negative.** Near-black ground, pure-white ink. Auto via `prefers-color-scheme`.

## Palette

Every value is AA-verified numerically (computed WCAG relative-contrast ratios; full tables below). Light grounds: `paper #FAFAFA`, `paper-white #FFFFFF`, `paper-sunken #F1F1F1`. Dark grounds: `paper #0A0A0A`, `paper-white #141414`, `paper-sunken #050505`. AA text threshold = 4.5:1.

### Light — "white zen" (default)

| Token | Hex | Role | AA (paper / white / sunken) |
|---|---|---|---|
| `--paper` | `#FAFAFA` | Page ground (soft white, not glaring) | ground |
| `--paper-white` | `#FFFFFF` | Plates, cards, long-reading blocks | ground |
| `--paper-sunken` | `#F1F1F1` | Recessed zones, zebra, sunken wells | ground |
| `--ink` | `#111111` | Body | 18.09 / 18.88 / 16.72 |
| `--ink-display` | `#000000` | Bold-black headlines, pure black | 20.12 / 21.00 / 18.59 |
| `--ink-muted` | `#5C5C5C` | Captions, meta | 6.41 / 6.69 / 5.92 |
| `--ink-faint` | `#9A9A9A` | Ticks, disabled — **graphic/large only** (sub-AA by design) | 2.70 / 2.81 / 2.49 |
| `--hairline` | `#E4E4E4` | 1px rules, figure plate borders | graphic |
| `--hairline-strong` | `#C6C6C6` | Stronger dividers, active borders | graphic |
| `--accent` | `#F0268C` | FLASH PINK graphic signal (fill/active/tick/underline) | graphic |
| `--accent-strong` | `#CF1273` | Press/hover, tick strokes | graphic |
| `--accent-text` | `#C0106B` | Deep magenta for accent TEXT on white | 5.70 / 5.95 / 5.27 |
| `--accent-fg` | `#000000` | Fixed pure-black LABEL on pink fills (both themes) | 5.36 on `--accent` |
| `--amber` | `#7A5A0E` | Status: pending (admin) | 6.10 / 6.37 / 5.64 |
| `--clay` | `#B23A22` | Status: destructive (admin) | 5.71 / 5.96 / 5.28 |
| `--terracotta` | `#E07A3F` | **DATA ONLY** (score ramps / geometry viz) | banned from chrome |
| `--ring` | `#111111` | Focus ring = ink | 18.09 (≥3 graphic) |

### Dark — "black zen" (the negative)

| Token | Hex | Role | AA (paper / white / sunken) |
|---|---|---|---|
| `--paper` | `#0A0A0A` | Near-black page ground | ground |
| `--paper-white` | `#141414` | Elevated plates / reading | ground |
| `--paper-sunken` | `#050505` | Deepest recessed | ground |
| `--ink` | `#F2F2F2` | Body (the negative) | 17.68 / 16.46 / 18.21 |
| `--ink-display` | `#FFFFFF` | Brightest headline ink, pure white | 19.80 / 18.42 / 20.38 |
| `--ink-muted` | `#A3A3A3` | Captions, meta | 7.85 / 7.30 / 8.08 |
| `--ink-faint` | `#666666` | Ticks, disabled — graphic/large only | 3.45 / 3.21 / 3.55 |
| `--hairline` | `#262626` | 1px rules | graphic |
| `--hairline-strong` | `#3D3D3D` | Stronger dividers | graphic |
| `--accent` | `#FF4FA3` | Flash pink on near-black | graphic |
| `--accent-strong` | `#FF77B8` | Press/hover | graphic |
| `--accent-text` | `#FF6FB0` | Pink as text on dark | 7.69 / 7.15 / 7.91 |
| `--accent-fg` | `#000000` | Fixed pure-black label on pink fills | 6.90 on `--accent` |
| `--amber` | `#E0A93A` | Status: pending | 9.34 / 8.69 / 9.61 |
| `--clay` | `#F0876B` | Status: destructive | 7.90 / 7.35 / 8.14 |
| `--terracotta` | `#EF8F56` | DATA ONLY | banned from chrome |
| `--ring` | `#F2F2F2` | Focus ring = ink | graphic |

### Button fills (both themes)

- **Primary** = ink fill / paper text: `bg-ink-display text-surface`. Light 20.12:1, dark 19.80:1. (Button variant key stays `pine` for API stability; brand pine is retired.)
- **Accent** = pink fill / fixed pure-black label: `bg-accent text-accent-fg`. Light 5.36:1, dark 6.90:1. Hover lightens via opacity (darkening to `--accent-strong` would drop the black label below AA: `#000000` on `#CF1273` = 3.99:1).

### Retirements & holdovers

- **All warm/creme tint retired.** rev-5's creme grounds (`#F3F1E9` family), warm near-black ink (`#191510`/`#0C0A06`), and warm hairlines are gone. Grounds and ink are pure neutral gray; display is truest black (light) / pure white (dark).
- **Road-yellow retired** (since rev 5). **Pine retired as brand-primary** (since rev 5); primary chrome goes ink (fill = ink-display, text = paper) with pink as THE signal CTA. `--pine`/`--pine-strong` remain defined as an INTERIM ink hold only so un-reskinned components still build; the last references clear in u18.
- **Terracotta stays DATA-ONLY** (draw trace, ramp mirrors). Hard ban from chrome.
- **Data ramps SEALED** (`mapConfig.ts` RAMP / BINS / COMMUNITY_CASING / widths + the render-script mirror): untouched. On a grayscale world they are the loudest color on screen, which is the point; they coexist inside figures/legends only. Admin `--amber`/`--clay` are AA status tokens (data/status semantics), not a chrome accent.
- **Shadows are zen-soft.** rev-5's near-flat ink-tinted shadows are replaced by large-radius, very-low-alpha diffuse black shadows: `--shadow-panel: 0 10px 40px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)` (light); `--shadow-popover` is a slightly stronger member of the same family. Dark keeps the geometry with deeper black alphas.
- **Radii 2/4/6px** (`--radius-chip 2` / `--radius-panel 4` / `--radius-primary 6`). Plates are square-ish; big radius reads SaaS.
- **Glass is true backdrop-blur, over live map tiles ONLY.** `--glass-bg` is a neutral white tint (`rgba(255,255,255,0.66)` light / `rgba(10,10,10,0.58)` dark), `--glass-border` a neutral hairline, and `--glass-blur` (18px) is the sanctioned blur radius. Never on flat grounds.

### Token strategy (implementation note)

The rev-4 token names components already consume (`--surface-base/elevated/sunken`, `--ink`, `--neutral-strong/neutral/soft`, `--border`/`--border-strong`, `--pine`/`--pine-strong`, `--accent*`, `--ring`) are **kept and re-valued**, aliased via `var()` onto the rev-5/6 vocabulary to minimize churn. This alias architecture is unchanged from u13; rev 6 is a re-valuation pass. Prefer the rev-6 names for new work: `bg-paper`/`bg-paper-white`/`bg-paper-sunken`, `text-ink-display`/`text-ink-muted`/`text-ink-faint`, `border-hairline`/`border-hairline-strong`, `text-accent-fg`, `text-amber`/`text-clay`. Legacy → rev-6 mapping: `surface-*`→`paper*`, `neutral-strong`→`ink-muted`, `neutral`→`ink-faint`, `neutral-soft`/`border`→`hairline`, `border-strong`→`hairline-strong`.

## Type system

Unchanged from rev 5. Faces via `next/font/google`: **Space Grotesk** (`--font-display` AND `--font-sans` for UI chrome), **Newsreader** (`--font-serif`, weights 400/500 + italics, `opsz` auto — landing/prose voice), **IBM Plex Mono** (`--font-mono`, instrument).

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

## Layout

The hero is being restructured in u17 (the platform IS the hero: a live embedded audit map with the title block, abstract, CTA, and live stat cards on the flanks, mcbroken-style; every deeper action opens the full platform at `/[locale]/map`). The manifesto document survives below the hero, re-toned, keeping its structure. Below-hero bands stay Distill-style centered: `text` ~68ch/680px (all prose + headlines) · `outset` ~840px · `page` ~1080px (wide figures/tables) · `screen` full-bleed (map figure, closing band) · `gutter` right sidenote lane ~200–260px at ≥1180px. Vertical rhythm: 8px base, 96–120px between sections, a column-width 1px `--hairline` rule between sections. Numbered sections `01/02/03…` in mono. Vocabulary: centered italic abstract · sparing epigraphs · sidenotes with mono superscript counters (collapse to inline tap-reveal on mobile) · GroundingSection's hairline `<dl>` stays the canonical References block · at most ONE newthought/dropcap on the whole page, or none.

## The map as FIGURE 1

Live, interactive, matted: page ground → 1px `--hairline` border → 8–16px `--paper` mat inset → tiles (tiles never touch the border). Corners ≤4px. Bounded aspect (3:2 or 16:10 desktop; taller on phone), NOT full-viewport in the document sections (the hero embed in u17 is larger). Caption block below, left-aligned: mono `FIGURE 1.` → Space Grotesk 700 claim → Newsreader support → mono source line (`Source: StreetLens field audits · n=… · retrieved <date>`, hairline above). One quiet mono affordance line (`↔ drag · scroll to zoom · tap a segment`). LIVE dot in `--accent` + mono timestamp. Data panels floating on the tiles may use true glass (`--glass-bg` + `--glass-blur`); the legend chip + LIVE dot read as glass chips on the map. MapLibre controls minimal monochrome; attribution a tiny mono data-source line. Cross-reference the figure from prose. Product shots elsewhere become Figure 2/3 with the same plate treatment.

## Texture

Flat grounds + hairlines carry structure; zen-soft diffuse shadows carry card lift. The tiled `.contour-field` motif stays retired (the class remains a no-op). No body micro-grain, no tiled decorative pattern behind text.

## Depth

Max three elevation levels: base (flat ground), floating card (`--shadow-panel`, zen-soft diffuse), popover/modal (`--shadow-popover`, a slightly stronger member of the same family; map app + overlays). Glass (backdrop-blur) is a fourth, orthogonal treatment reserved for panels floating over live map tiles — never stacked, never on a flat ground. Every interactive element carries a non-shadow affordance: a 1px hairline and/or a background step. All text ≥4.5:1 (AA). No inset emboss/deboss neumorphism; no glassmorphism on flat surfaces.

## Iconography

Phosphor or Lucide at one consistent stroke weight. Zero emoji in UI.

## Score ramps (SEALED — data meaning, never chrome)

One active layer at a time, colorblind-safe, plus a line-WIDTH channel. Overall teal→amber→clay (`#0E7C66`→`#E8B84B`→`#C0472B`, high = good); Accessibility Cividis blue; Drainage Viridis blue-teal→dull yellow; Shade canopy green→pale bone; Bike sand→copper; community casing neutral grey dashed. Legend always visible with explicit value bins; never color-only encoding. These live in `mapConfig.ts` and its `scripts/render-map-images.mjs` mirror and MUST NOT change. On the grayscale-zen basemap they become the loudest color on the map, which is the intent.

## Basemap (grayscale zen)

`BASEMAP`/`HILLSHADE_PAINT`/`BUILDINGS.color` in `mapConfig.ts` (+ the render-script mirror) are retinted to grayscale zen, both themes: land = the page ground, roads step up to pure white (light) / brightest gray (dark), parks and land-use are quiet neutral grays, water is a barely-there gray-blue (the one non-neutral note, kept nearly desaturated), buildings and boundaries read as neutral grays / hairline. Hillshade is neutral black/white shadow+highlight. All warm tint retired. After any change, re-run `npm run render:maps` so the static plates match the live map. RAMP stays sealed; the score ramps and flash pink are the only strong chroma on the map.

## rev-6 BAN LIST (additive; all prior bans hold except superseded color rules)

- **No warm / cream tints anywhere.** Grounds, ink, hairlines, glass, shadows, and the basemap are pure neutral (plus the one whisper of gray-blue in map water). rev-5's creme palette is fully retired.
- **No backdrop-blur on flat grounds.** Glass is permitted ONLY over live map tiles. Cards on white/black lift on zen-soft shadows + hairlines, never blur.
- **No heavy classic neumorphism** (inset emboss/deboss, double-shadow "pressed" chrome). Zen-soft shadows only: single large-radius diffuse lift, very low alpha.
- Serif in any headline/display slot; no high-contrast display serifs anywhere (Fraunces, Playfair, DM Serif, Libre Caslon, Cormorant).
- Reading text on saturated color grounds.
- Drop-shadow card grids as layout busywork (hairlines + zen-soft lift, used with restraint). Rounded-xl/2xl figure frames.
- Badge-pill + two-CTA centered hero.
- Tiled decorative pattern behind text.
- Terracotta or any data-ramp hue in chrome. Road-yellow anywhere (retired).
- Pink as decoration: washes, gradients, glows, big pink blocks, pink body text. Pink is a SIGNAL.
- (prior bans hold) Purple/indigo gradients · gradient-mesh/aurora backgrounds · decorative glows on chrome · colored left-border cards · Inter-only typography · emoji as headers/icons · identical icon-top 3-card feature rows · uniform rounded-xl everywhere · stat-banner filler rows · meaningless status dots · rainbow accent tabs · deep card nesting · fake testimonials/logo clouds · sub-AA gray body text · unthemed default shadcn · full-saturation neon palettes.

## Copy register (EN + ES parity, array lengths equal)

Declarative, imperative, parallel, plain. Eyebrows mono caps; theses bold black. ES keeps the parallel/imperative cadence, not literal word-for-word. NO em dashes in new copy (house rule): use periods, colons, semicolons, parentheses per grammar.

## Changelog

- rev 2 (2026-07-15): Space Grotesk replaces Bricolage Grotesque + Hanken Grotesk app-wide, founder direction.
- rev 3 (2026-07-15): Ban-list glassmorphism narrowed to imagery-backed surfaces only (founder direction).
- rev 4 (2026-07-15): Brand evolution off the AI-slop cluster. Cool concrete-paper grounds, road-marking yellow accent, terracotta demoted to data-only, asphalt green-black dark mode, Plex Mono promoted to instrument voice, topographic contour texture.
- rev 5 (2026-07-16): **Field Manifesto.** Paper/ink/flash-pink retoken across both themes (light paper / dark inverted-paper); road-yellow and pine-as-brand retired. Newsreader serif wired as the prose voice (never a headline). Contour texture and body grain retired for flat paper + hairlines. Radii → 2/4/6, shadows near-flat, glass restricted to live-map-tile survivors, `--ring` = ink. Admin `--amber`/`--clay` promoted as AA status tokens; `--accent-fg` added as the fixed dark label for pink fills.
- rev 6 (2026-07-16): **Zen Instrument.** Full token re-valuation from creme-paper to pure black-and-white zen, both themes (light: soft-white page `#FAFAFA` / pure-black ink; dark: near-black page `#0A0A0A` / pure-white ink); all warm tint retired. Shadows re-valued to a zen-soft diffuse family (large radius, very low alpha); glass upgraded to true backdrop-blur (`--glass-blur` 18px) over live map tiles only, neutral white tint. `--accent-text` → `#C0106B` (light), `--accent-fg` → pure black `#000000` (both themes); `--amber`/`--clay` re-verified AA on the neutral grounds. Basemap retinted to grayscale zen (BASEMAP/HILLSHADE/BUILDINGS + render-script mirror, static plates regenerated); sealed RAMP untouched. Ban list: added no-warm-tint, no-blur-on-flat, no-emboss-neumorphism; dropped creme-specific lines. The alias architecture (u13) is unchanged; this is a re-valuation plus shadow/glass upgrade. Hero-as-platform restructure + landing re-tone is u17; full-platform + admin glassier panels are u18.
