# StreetLens Design Direction (v1, sealed 2026-07-14)

Binding for all UI work. Derived from design research (mcbroken/Tree Equity/Strava/PetaBencana teardowns + AI-slop pattern catalogs). Deviations require Conductor approval.

## Identity

A warm, eco-urbanist civic instrument. Map-first like mcbroken, credible like Tree Equity Score, calm tactile softness. A tool, not a landing page. The app opens directly into the full-bleed Escazú map; no marketing hero, no centered two-CTA block.

## Type (Google Fonts)

- Display/headlines and UI/body: **Space Grotesk** (single app-wide typeface)
- Numeric readouts, scores, coordinates: **IBM Plex Mono**
- Inter/Roboto/Open Sans are prohibited as primary faces.

## Palette (light mode)

- Base surface: warm bone `#F4F1EA`; elevated surface `#FBFAF6`
- Text ink: `#1C2321`
- Primary: deep pine green `#1F5C4A`
- Accent (interactive, sparing): terracotta `#E07A3F`
- Warm neutral ramp: `#6B7069` / `#9AA097` / `#D8D6CC`

Dark mode: near-black warm base `#14140F`, label-stripped basemap, active data layer gets a subtle Strava-style glow. Glow exists ONLY on data, only in dark mode.

## Score ramps (one active layer at a time, colorblind-safe, plus line-WIDTH channel)

- Overall: teal → amber → clay (`#0E7C66` → `#E8B84B` → `#C0472B`), high = good
- Accessibility: Cividis-style blue sequential
- Drainage: Viridis-style blue-teal → dull yellow
- Shade: canopy green `#14532D` → pale bone `#DDE3CE`
- Legend always visible with explicit value bins. Never color-only encoding.

## Depth: soft-depth, NOT neumorphism

- Dual warm-tinted shadow (soft ambient + tight directional), never pure black.
- Max 3 elevation levels: base, floating panel, popover/modal.
- Every interactive element carries a non-shadow affordance: 1px border at ≥3:1 and/or background step.
- At most one neumorphic micro-control (the layer switcher), only if it passes 3:1 with a label.
- All text ≥4.5:1 (AA). Optional subtle paper-grain on bone base. No glassmorphism.

## Radius system (non-uniform, intentional)

4px chips/inputs/score pills · 8px panels/cards · 12px only the primary floating map panel. Blanket `rounded-xl/2xl` prohibited.

## Iconography

Phosphor or Lucide at one consistent stroke weight. Zero emoji in UI.

## Layout

- Full-bleed map; floating left panel: layer switcher + legend + one live hero stat (e.g., "X% of audited segments fail Ley 7600 minimums").
- One repeated panel primitive, not five card styles.
- Data density is a feature: real counts, coverage %, mono numerals.

## Motion

One signature: smooth map fly-to on segment select + gentle hover ease on segments. Nothing auto-animates.

## Basemap

Start from OpenFreeMap Liberty/Positron or Protomaps grayscale flavor; strip POIs and most labels; warm-neutral land, soft green parks, muted water; restrained label hierarchy (city > district > major road). Data layer must dominate.

## BAN LIST (any 4+ = redo)

Purple/indigo gradients · glassmorphism cards · gradient-mesh/aurora backgrounds · decorative glows on chrome · colored left-border cards · Inter-only typography · centered hero with badge-pill + two CTAs · emoji as headers/icons · identical icon-top 3-card feature rows · uniform rounded-xl everywhere · stat-banner filler rows · 1-2-3 step marketing sequences · meaningless status dots · all-caps micro-labels as the only hierarchy · rainbow accent tabs · deep card nesting · fake testimonials/logo clouds · sub-AA gray body text · unthemed default shadcn · full-saturation neon palettes.

## shadcn rule

Override every token (base colors, radius per system above, ring = pine green, fonts, custom shadow tokens). Nothing ships looking default.

## Changelog

- rev 2 (2026-07-15): Space Grotesk replaces Bricolage Grotesque + Hanken Grotesk app-wide, founder direction.
