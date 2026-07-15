# PLAN — u6-bike-layer (bike as the fifth score layer, contract v2)

Advisor: `.bgsd/runs/sesh-1784059200603/advisor/u6-bike-layer.md` (rev 1). Base `next` @ 6b71987.

## Goal
`bike` becomes the fifth first-class score layer end to end: contract v2 in lib,
data regeneration, migration 0011, mapConfig copper ramp, five UI toggles, a bike
contribution tier, all bilingual (EN canonical, es-CR).

## Key finding (adjudication item)
Cached Overpass data for San Antonio has **no real cycleway/bike-lane infra**
(0 `highway=cycleway`; 1 way `cycleway=no bicycle=yes`). Consistent with the app's
demo philosophy (all four existing score layers are synthetic over real geometry),
`score_bike` is a deterministic spatial+road-classification model: near-zero on most
residential streets, modest on through-roads (secondary/tertiary/unclassified — the
plausible cycle corridors), plus a bonus where a real `bike_infra` OSM hint exists
(none present today). No specific street is misrepresented as having infrastructure
it lacks. Spot-check demonstrates the classification spread (through-roads > residential)
rather than literal cycleway tags, since none exist.

## Contract v2 (Conductor-adjudicated)
- `ScoreLayer` gains `'bike'` (last); `SCORE_LAYERS` gains `'bike'` (last).
- `SegmentProperties.score_bike: number` (0-100, high = good bike infra).
- StreetStats unchanged (heroPct stays accessibility-based).
- Ramp: value0 `#E8D9C4` pale sand → mid → value100 `#8A4B2D` deep copper, high=good,
  with the `{value0, value100}` assertion comment.

## Commit sequence (atomic, explicit pathspecs)
1. **lib contract v2** — `lib/types.ts` + `lib/segments.ts`: ScoreLayer/SCORE_LAYERS,
   score_bike on SegmentProperties, both read paths (view row + static fallback +
   enrichFeature default), RubricItemRow layer union.
2. **mapConfig** — `components/mapConfig.ts`: LAYER_ORDER += bike, RAMP.bike copper +
   assertion, RUBRIC_ITEMS.bike (3 keys).
3. **importer** — `scripts/import-osm-corridor.mjs`: harvest bike tags (cycleway,
   cycleway:left/right/both, bicycle; `highway=cycleway` ways included + made auditable),
   carry `bike_infra` hint (none|lane|track|shared|cycleway) onto each segment.
4. **generator** — `scripts/generate-demo-audits.mjs`: score_bike model + 3 bike rubric
   items (bilingual), emit score_bike into demo-segments + seed bike observations.
5. **regenerated data** — run importer then generator; commit `data/segments.geojson`,
   `data/demo-segments.geojson`, `data/demo-audits.json`, `supabase/seed.sql`.
6. **migration** — `supabase/migrations/0011_bike_layer.sql`: extend rubric_items.layer
   check to include 'bike'; rebuild `v_segment_scores` to expose `score_bike`.
7. **smoke** — `scripts/smoke-adapter.mjs`: assert score_bike on every feature, 535 count,
   SCORE_LAYERS value includes bike.
8. **UI** — `components/LayerSwitcher.tsx` (Bike icon) + `components/SegmentDetail.tsx`
   (bike in scores map). Switcher/detail/legend/panel are generic over LAYER_ORDER.
9. **AuditMap** — no logic change needed (generic over ScoreLayer + score_${layer});
   verify the default/apply paths compile with 5 layers.
10. **messages** — `messages/en.json` + `messages/es.json`: layers.bike, rubric.bike,
    contribute.conditions.bike.
11. **contribution tier** — `components/contribute/conditions.ts`: add `bike` condition
    key + options (auto-renders in both forms via ConditionFields; useContribute.ts untouched).

## Verification bar
- `npm run smoke` (node smoke-adapter): 535 features all carry score_bike, PASS.
- `npm run build && npm run lint` + `npx tsc --noEmit` green.
- Regenerated data spot-check: score_bike in 0..100 for all; through-roads average
  meaningfully > residential average; deterministic re-run byte-identical (modulo
  generated_at timestamps, pre-existing behavior).
- Migration reviewed; PostGIS container re-verify if cheap.
- One screenshot of bike layer active if quick — never blocking.

## Boundaries
Own: importer, generator, data, migration 0011, lib contract, mapConfig, LayerSwitcher/
Legend/MapPanel/SegmentDetail/AuditMap bike bits, conditions.ts bike tier, messages.
Do NOT touch: components/contribute/useContribute.ts, trace/routing (u5), admin beyond score display.
