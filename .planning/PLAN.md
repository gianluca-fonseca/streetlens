# PLAN — u8-3d-mode

Add native MapLibre 3D to the Escazú audit map, exactly per the ratified research
sketch and advisor rev 1. Purely additive: no change to score RAMP/expressions,
no data/stat changes. 3D is presentational; the 2D top-down score view stays primary.

## Scope / boundaries
- `components/mapConfig.ts` — ADD terrain DEM + hillshade + building-extrusion
  constants/expressions. Do NOT touch RAMP or the score line color/width exprs.
- `components/AuditMap.tsx` — wire the DEM source, always-on hillshade, the 3D
  toggle handler (terrain + pitch + buildings + pitch nav control), mobile pitch cap.
- `components/ThreeDToggle.tsx` — NEW small design-direction control, lucide icon,
  bilingual, rendered from AuditMap's overlay near the layer-switcher column.
- `messages/en.json` + `messages/es.json` — add `map.threeD.*` strings.
- `.planning/evidence/u8/MANUAL-VERIFY.md` — honest click-through steps.

## Implementation steps (atomic commits)
1. **mapConfig terrain constants** — `TERRAIN` (source id, terrarium tiles,
   encoding, tileSize 256, maxzoom 15, USGS/Copernicus attribution), `HILLSHADE`
   (paint tuned to warm muted palette, light + dark), `BUILDINGS` (layer id
   candidates, muted color light/dark, coalesced fill-extrusion-height expr
   `["case", [">", render_height, 5], render_height, 9]`, base = render_min_height,
   minzoom 14). Exported; RAMP/expressions untouched.
2. **ThreeDToggle component** — button toggle, 8px panel radius, 1px border ≥3:1,
   pine active state, lucide icon, aria-pressed, bilingual label.
3. **AuditMap wiring** — mobile pitch cap at construction (maxPitch 60 on
   touch/narrow, else 70); NavigationControl gains `visualizePitch: true`;
   `setupTerrain(map, dark)` adds DEM source + always-on hillshade (inserted below
   roads) + registers/hides the building extrusion layer with muted paint;
   `applyThreeD(map, on)` toggles setTerrain(exag 1.4)/null + eased pitch 60/0 +
   building visibility; `threeD` state + toggle rendered under the MapPanel column;
   re-apply hillshade colors on theme change.
4. **messages** — `map.threeD` (label "3D view"/"Vista 3D", aria enable/disable).
5. **evidence** — MANUAL-VERIFY.md (what to click, expected 2D vs 3D behavior);
   optional quick Playwright 2D/3D screenshot pair if non-blocking.

## Verification bar
tsc (`npx tsc --noEmit`) + lint (`npm run lint`) + build (`npm run build`) green.
No node-level test applies; MANUAL-VERIFY.md committed instead.
