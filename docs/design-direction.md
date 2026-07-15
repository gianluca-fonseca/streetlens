# StreetLens Design Direction (rev 4, sealed 2026-07-15)

Binding for all UI work. Derived from design research (mcbroken/Tree Equity/Strava/PetaBencana teardowns + AI-slop pattern catalogs) and Anthropic's design-quality guidance. Deviations require Conductor approval.

## Identity

A survey-instrument civic tool for the street. Map-first like mcbroken, credible like Tree Equity Score, calibrated and calm. A field instrument, not a landing page. The app opens directly into the full-bleed Escazú map; no marketing hero, no centered two-CTA block. The identity is grounded in the subject's world (asphalt, road paint, topographic contours, field survey plates), not generic SaaS polish. The former "warm cream + serif/display + terracotta accent" identity is retired: the design-quality audit flagged that exact cluster as an AI-generated-design cliché.

## Type (Google Fonts)

- Display/headlines and UI/body: **Space Grotesk** (single app-wide typeface). Differentiate through TREATMENT, not the face: at hero sizes (>40px) display goes heavier (bold) and tighter (negative tracking) on a deliberate modular scale, so it reads like an instrument plate title, not a startup template.
- Instrument voice: **IBM Plex Mono** is promoted to a first-class label voice. Every eyebrow, section label, legend title, stat caption, table header, status pill, and nav meta is wide-tracked uppercase mono. Numeric readouts, scores, and coordinates stay mono. This is what carries the "calibrated field plate" feel.
- Inter/Roboto/Open Sans are prohibited as primary faces. Undifferentiated default-treatment Space Grotesk (regular weight, default tracking, no mono label system) is prohibited: the treatment is the differentiation.

## Palette (light mode)

Neutrals are chosen with a deliberate green hue bias toward the brand, not inherited cream or mid-grey. Every value below is AA-verified (see the u11 contrast table).

- Grounds (cool concrete-paper, green-biased, OFF-cream): base `#F2F3F0`; elevated `#FAFBF9`; sunken `#E9EBE6`
- Text ink: `#171D1A`
- Primary: deep pine green `#1F5C4A` / `#164034`
- UI accent, road-marking yellow (lane paint), the single sanctioned aesthetic risk: saturated graphic form `#E8C51C` (fills, active markers, highlights, at 1.4:1 it is graphic-only) with a text-safe dark ochre `#756211` for accent TEXT on light grounds (min 4.98:1 AA). CTAs, active states, and key highlights key to this accent.
- Warm-green neutral ramp: `#565C54` (secondary body, min 5.73:1 AA) / `#8B9188` / `#D3D6CF`
- Terracotta `#E07A3F` is a DATA color only: it survives inside score ramps and the admin geometry-trace endpoints, and appears nowhere in chrome.

Dark mode: asphalt green-black grounds (base `#10130F`, elevated `#191D17`, sunken `#0B0E0A`), label-stripped basemap. The yellow accent reads beautifully on asphalt and folds accent-text back to the saturated form (min ~10:1 AA). The active data layer gets a subtle Strava-style glow. Glow exists ONLY on data, only in dark mode. Dark redefines token VALUES only; components style through the same tokens as light.

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
- All text ≥4.5:1 (AA). No glassmorphism on flat surfaces.

## Texture

Marketing surfaces carry a subtle topographic contour-line motif (a static SVG of a few nested contour lines with the feel of an Escazú hillside), very low contrast, tiled below content. It replaces the generic paper-grain dot, which read as default. One asset serves both themes (ink strokes on light, inverted on asphalt-dark). App/admin body may keep the base grain.
- Earned glass (rev 3, imagery-backed surfaces only): a floating panel layered directly over map imagery, a live map, or a rendered map render MAY use backdrop-blur with a warm bone tint (`bg-[rgba(244,241,234,0.72)]` light / warm-dark equivalent), `backdrop-blur-md`, a 1px warm border, and the existing soft-depth shadow tokens. Glass is earned, never default: only over imagery, always carrying real data or content, never on a flat bone/field background, and never stacked glass-on-glass. Every other depth rule (AA text, 3 elevation levels, radius system) still applies.

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

Warm cream `#F4F1EA` + serif/display + terracotta accent cluster (the AI-slop identity the audit flagged) · undifferentiated default-treatment Space Grotesk (regular weight, default tracking, no mono label voice) · Purple/indigo gradients · glassmorphism cards · gradient-mesh/aurora backgrounds · decorative glows on chrome · colored left-border cards · Inter-only typography · centered hero with badge-pill + two CTAs · emoji as headers/icons · identical icon-top 3-card feature rows · uniform rounded-xl everywhere · stat-banner filler rows · 1-2-3 step marketing sequences · decorative numbered markers where no real sequence exists · meaningless status dots · all-caps micro-labels as the only hierarchy · rainbow accent tabs · deep card nesting · fake testimonials/logo clouds · sub-AA gray body text · unthemed default shadcn · full-saturation neon palettes.

## shadcn rule

Override every token (base colors, radius per system above, ring = pine green, fonts, custom shadow tokens). Nothing ships looking default.

## Changelog

- rev 2 (2026-07-15): Space Grotesk replaces Bricolage Grotesque + Hanken Grotesk app-wide, founder direction.
- rev 3 (2026-07-15): Ban-list item 2 (glassmorphism cards) is narrowed for imagery-backed surfaces only. Founder direction (Genesis-grade art direction): floating panels layered over map imagery, a live map, or a rendered map render MAY be glass (warm bone tint `bg-[rgba(244,241,234,0.72)]` light / warm-dark equivalent, `backdrop-blur-md`, 1px warm border, existing shadow tokens). Glass is earned, not default: only over imagery, always carrying real data or content, never on a flat background, never stacked glass-on-glass. The other 19 ban items and all depth/AA rules stand.
- rev 4 (2026-07-15): Brand evolution off the AI-slop cluster the design-quality audit flagged (cream `#F4F1EA` + serif/display + terracotta). Grounds move OFF-cream to cool concrete-paper with a green hue bias; the single UI accent becomes road-marking yellow (`#E8C51C` graphic / `#756211` text-safe ochre); terracotta is demoted to a data-only color; dark mode rebases to asphalt green-black. Type differentiates through treatment: Plex Mono is promoted to a first-class instrument label voice and Space Grotesk display goes heavier/tighter at hero sizes (the face stays, per founder directive). Marketing surfaces get a topographic contour motif in place of the paper-grain dot. Decorative numbered markers with no real sequence are removed (MethodSection). Glass tints retint to the new grounds. The imagery-backed glass exception (rev 3) and all depth/AA rules stand; glass tint token is now `rgba(242,243,240,0.72)` light / `rgba(16,19,15,0.62)` dark.
