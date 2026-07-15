# u1-design-map — Verification evidence

Dev server: `PORT=3111 npm run dev` (Next 16 / Turbopack). Driven with Playwright MCP.
Gates: `npm run build` ✓ green, `npm run lint` ✓ clean (0 problems). 0 console errors.

## Screenshots
- `01-overall-landing.png` — first render of the floating panel (pre map-height fix; map blank — see note).
- `02-overall-map.png` — full-bleed muted basemap + Overall ramp segments (after height fix).
- `03-accessibility-layer.png` — layer switch to Accessibility; Cividis ramp with corrected direction.
- `04-segment-detail-flyto.png` — segment click → fly-to + elevated detail panel.
- `05-spanish-locale.png` — `/es` fully localized (es-CR "acera").

## Acceptance checks
- Full-bleed, map-first landing (no marketing hero) — PASS.
- Muted basemap: POIs stripped, place labels kept (Escazú, Alajuelita), warm-neutral land / soft parks / muted water — PASS.
- Four score layers with exact ramps + redundant line-width channel (thicker = lower score) — PASS.
  - Accessibility + Drainage ramp directions corrected per advisor rev 2 (0 = barriers/flood-prone, 100 = good), asserted with value0/value100 comments in `components/mapConfig.ts`.
- Layer switcher (the one soft segmented micro-control): bordered, labelled, single-stroke icons, keyboard radiogroup, active state = bg step + pine — PASS.
- Always-visible legend: explicit value bins (0–39/40–59/60–79/80–100) with color + width cue, one-line width-channel explanation (EN/ES) — PASS.
- Floating panel: hero stat from getStats() (heroPct = % failing Ley 7600 accessibility min), mono coverage figures (segments / km / coverage) — PASS.
- Segment click: smooth fly-to (fitBounds with panel-aware padding) + elevated detail panel with per-layer scores, active-layer rubric breakdown placeholder, photo placeholder grid — PASS.
- Bilingual: EN canonical + complete es-CR ("acera", Ley 7600); switcher/legend/panel/detail/rubric all translated — PASS.

## Notes
- Map-height bug found and fixed during verification: MapLibre adds `.maplibregl-map { position: relative }`, which overrode the Tailwind `absolute inset-0` on the map container and collapsed its height to 0 (blank canvas). Fixed by anchoring the wrapper `absolute inset-0` in the relative `<main>` and sizing the container `h-full w-full` + a defensive `resize()` on load (commit 5eecb8c).
- 4 console WARNINGS ("Expected value to be of type number, but found null") originate from the MapLibre worker evaluating the OpenFreeMap Liberty basemap style (consistent 4× at every load, independent of the 8 data features). Non-blocking; not from the data-layer expressions (segments render with correct color + width).
