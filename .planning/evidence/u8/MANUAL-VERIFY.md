# u8 — 3D mode manual verification

Purely additive MapLibre 3D on the Escazú audit map: AWS Terrarium DEM, an
always-on hillshade, a "3D" toggle (terrain + pitch + building extrusions), and a
mobile pitch cap. No score/RAMP/stat changes. This file is the honest
click-through; no fabricated screenshots. A quick Playwright 2D/3D pair may be
added later but is non-blocking.

## Preconditions
- `npm run dev`, open the audit map page.
- Network reachable (Terrarium tiles from `s3.amazonaws.com/elevation-tiles-prod`,
  OpenFreeMap Liberty tiles). If Liberty fails, the fallback demotiles style loads
  and 3D building extrusions may be unavailable — hillshade/terrain still work.

## What to click and expect

### 1. Default is 2D (unchanged analytic view)
- On load the map is flat: pitch 0, top-down. Score-ramp street colors read
  exactly as before.
- A subtle relief (hillshade) is visible over land — soft warm shading that
  follows Escazú's slopes. It must NOT wash out or fight the score ramp colors.
- The "3D view" control sits below the primary map panel (left column), near the
  layer switcher. Off state: neutral surface, pine icon + label. `aria-pressed`
  is `false`, `aria-label` = "Enable 3D view" (EN) / "Activar la vista 3D" (ES).

### 2. Enable 3D
- Click "3D view". Expect:
  - Camera eases to ~60° pitch (smooth, ≈0.9s).
  - Terrain relief becomes real 3D (hills rise; exaggeration 1.4).
  - Zoom to ≥14 (z14+): muted building extrusions appear. Untagged footprints
    coalesce to ~9 m boxes; genuinely tall tagged buildings keep their height.
  - Nav control (top-right) shows the pitch/rotate dial (`visualizePitch`); drag
    it or right-drag the map to rotate/pitch.
  - Toggle is now active (pine background, white icon/label); `aria-pressed` =
    `true`, `aria-label` = "Disable 3D view" / "Desactivar la vista 3D".

### 3. Disable 3D
- Click "3D view" again. Camera eases back to pitch 0 + bearing 0; terrain flattens
  (`setTerrain(null)`); building extrusions hide. Hillshade remains (always on).
  Score view is back to the exact 2D baseline.

### 4. Mobile pitch cap
- In a touch / narrow (<640px) viewport, 3D pitch is capped at 60° (desktop 70°).
  You cannot pitch past 60° on mobile even by dragging.

### 5. Theme change
- Toggle OS dark/light. Hillshade shadow/highlight and building extrusion color
  re-tint to the dark/light palette without reloading the map. Score ramps and
  community casing continue to track theme as before.

### 6. Attribution
- Open the attribution control (bottom, compact). It includes the Terrarium
  elevation credit (USGS 3DEP/SRTM/GMTED2010; Copernicus EU-DEM) alongside the
  existing OSM / OpenFreeMap credit.

## Honesty / readability check
3D is presentational only. The analytic score view stays flat and primary; no
data, scores, RAMP, or stats change between 2D and 3D. At oblique pitch, colored
streets foreshorten and can be occluded by buildings — expected, which is why the
default and analytic mode is 2D.

## Gates (run from the worktree)
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
