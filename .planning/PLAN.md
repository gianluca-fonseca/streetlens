# u5-trace-routing — PLAN

## Mission
Traced paths must FOLLOW THE STREET NETWORK between user dots, routing to the
connecting intersection and turning, instead of cutting straight lines through
blocks. "Follow streets" is ON by default with a toggle to free (straight) trace;
per-dot fallback to a dashed connector + warning when a dot can't be snapped/routed.

## Inspection findings
- `useContribute.ts`: trace state machine. `verts: Vertex[]` currently doubles as
  BOTH the user dots (circles) AND the rendered polyline (one dashed LineString).
  Draw handlers attach only in `trace` mode; refs drive async-safe map handlers.
- `ContributeUI.tsx`: `TraceControls` (undo/clear/finish) + instruction pill.
  `AddForm` submits `coordinates: contribute.verts`. Bilingual via next-intl.
- `import-osm-corridor.mjs`: caches raw Overpass to `data/raw/overpass-san-antonio.json`
  (557 highway ways) and splits AUDITABLE classes into ~150m block faces.
- Raw ways carry per-node `geometry` (lat/lon); OSM ways that meet at an
  intersection share the exact node coordinate → emitting ways verbatim as
  LineStrings preserves shared topology for `geojson-path-finder`.
- `schemas.ts`: `lineStringCoordsSchema` has a `min(2)` but NO max cap → routed
  polylines (more points) already validate; no cap to raise. Note in report.

## Approach
1. NETWORK ASSET — `scripts/build-routing-graph.mjs` → `data/routing-network.geojson`:
   every routable way (broad ROUTABLE set incl. footway/path/service) as a
   LineString, coords rounded to 6dp, only `{highway, osm_way_id}`. Lean.
   Verified: 557 ways / 3576 vertices / 571 junctions / 95.75 km / 165 KB.
2. DELIVERY — `app/api/routing-network/route.ts` serves the committed asset
   (nodejs runtime, immutable cache). Client fetches lazily (no initial-payload
   bloat, single committed source of truth).
3. ROUTING ENGINE — `components/contribute/routing.ts`:
   - `geojson-path-finder` (Dijkstra over LineString topology) + `@turf/nearest-point`
     vertex snapping (threshold ~30 m) + `@turf/distance`.
   - lazy, memoized `PathFinder` + vertex FeatureCollection built once from the
     fetched network.
   - `routeBetween(from,to)`: snap both dots to nearest vertices; `findPath`;
     return `{ coords, ok }`. `ok=false` (snap>threshold, disconnected, no path)
     → caller renders a dashed straight fallback + warning.
4. STATE — `useContribute.ts`:
   - `dots: Vertex[]` (user clicks) decoupled from the rendered polyline.
   - `followStreets` (default true) + toggle + ref.
   - routing effect recomputes `spans` (solid routed / dashed fallback / solid
     free-trace straight) whenever dots or the toggle change; stale-run guarded.
   - two line layers (solid routed + dashed fallback) + one vertex layer.
   - `pathCoordinates` = flattened routed polyline for submission + fly-to.
   - Undo removes the last USER DOT (and thus its span).
5. UI — `ContributeUI.tsx`: "Follow streets / Seguir calles" toggle in the trace
   toolbar; inline "couldn't follow streets here" warning when fallback spans > 0.
   AddForm submits `pathCoordinates`.
6. i18n — EN canonical + es-CR strings.

## Boundaries respected
Own: useContribute.ts, ContributeUI trace UI, build-routing-graph.mjs,
routing-network.geojson, new routing.ts + api route, message catalogs.
Do NOT touch: conditions.ts, mapConfig ramps, admin, migrations, lib/segments.ts.
`schemas.ts`: no cap change needed (no max exists).

## Verification bar
- `npm run build` + `npm run lint` + `tsc` green.
- `scripts/routing-test.mjs`: two coords on different streets route THROUGH the
  connecting intersection — assert routed length > straight-line, vertex count > 2,
  path contains the junction node; plus a disconnected-pair fallback assertion.
