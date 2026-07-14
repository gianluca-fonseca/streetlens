# u2-data-layer — Verification evidence

Run: sesh-1784059200603 · branch `unit/u2-data-layer` · advisor rev 4.

## 0. Honest correction (rev 4 remediation)

The first "done" declaration was premature: it was made against advisor rev 1
without re-reading the advisor file, which by then carried rev 4 (BLOCKING).
Conductor verification correctly failed it. Violations found and fixed:

1. **Export surface** — shipped `Stats` instead of `StreetStats`, omitted
   `SCORE_LAYERS`, and did not re-export `SegmentProperties` from
   `lib/segments.ts`. Fixed in `412011d` (surface now verbatim: `ScoreLayer`,
   `SCORE_LAYERS`, `SegmentProperties`, `SegmentCollection`, `SegmentDetail`,
   `StreetStats`, `getSegments`, `getSegmentDetail`, `getStats`, diffed against
   `git show unit/u1-design-map:lib/segments.ts`).
2. **Missing `district` + `audited_at`** on feature properties. Fixed in both
   paths: generator emits them and data was regenerated (`59392d6`); the live
   view surfaces them via migration `0009` (`9e1197b`); the adapter also
   defensively enriches stale static data (`412011d`).
3. **Smoke assertions** extended and committed as `scripts/smoke-adapter.mjs`
   (`a260942`): asserts export names against the frozen list and that every
   feature carries district, audited_at, and all four `score_*` fields.

All evidence below was re-run after these fixes.

## 1. Build + lint (green)

- `npm run lint` → clean (eslint, no errors/warnings).
- `npm run build` → compiled successfully, TypeScript passed, `/en` + `/es`
  prerendered. Baseline (pre-change) was also green; no regression.

## 2. Overpass importer — end-to-end, real geometry

`node scripts/import-osm-corridor.mjs` (live Overpass fetch, cached to
`data/raw/overpass-san-antonio.json`):

```
[import] wrote 535 segments (76.84 km audited / 95.69 km network, 80.3% coverage)
```

- **535 real-geometry segments** for San Antonio de Escazú — well above the ≥40
  bar. Stable ids `esc-sa-0001…esc-sa-0535`. Raw response cached for reproducibility.

## 3. Demo-audit generator — deterministic

`node scripts/generate-demo-audits.mjs`:

```
[demo] scored 535 segments; 155 fail Ley 7600 (accessibility < 50).
[demo] wrote data/demo-segments.geojson
[demo] wrote data/demo-audits.json
[demo] wrote supabase/seed.sql (6420 observations)
```

- Every feature `demo: true`. Spatial autocorrelation model (drainage worse near
  quebradas, sidewalks worse on steeper southern streets, smooth shade noise).
  Fixed PRNG seed → byte-stable across re-runs.

## 4. SQL migrations — applied against real PostGIS (not just reviewed)

Local Postgres CLI is absent (`psql`/`pg_ctl` not installed), but Docker was up
with the Supabase Postgres 17 + PostGIS image already cached. All nine
migrations were applied in order, on a FRESH instance after the rev 4 fixes,
with the `anon`, `authenticated`, `service_role` roles present:

```
0001_extensions … 0009_views_district_audited_at  → each: OK (ON_ERROR_STOP=1)
```

Then `supabase/seed.sql` loaded cleanly:

```
segments=535 | audits=535 | observations=6420 | rubric_items=12 | srid=4326
```

### RLS + RPC behavior (as role `anon`, RLS enforced)

| Check | Result |
| --- | --- |
| anon SELECT segments | 535 rows (public read OK) |
| anon SELECT submissions | 0 rows (RLS hides the queue) |
| anon INSERT pending submission | allowed |
| anon INSERT `status='approved'` submission | **ERROR: violates RLS policy** |
| anon UPDATE segments | 0 rows affected (no write path) |
| `admin_stats('WRONG')` | **ERROR: unauthorized** |
| `admin_stats('<secret>')` | `{"segments":535,"audits":535,"submissions_pending":…}` |
| `admin_review_submission(id,'approve',…,'<secret>')` | returns `approved` |

- `admin_rpc_secret` seeded into `app_secrets`; SECURITY DEFINER functions gate
  on the secret, not the role. `app_secrets` unreadable by anon.
- `v_segment_scores` view (post-0009): 535 rows, `geometry` as JSON object,
  **`district` and `audited_at` populated on all 535 rows (0 null/empty)**,
  readable by `anon` (security_invoker honors public-read RLS):

```
esc-sa-0001|Calle 130|San Antonio|2026-07-10|75|85|83|78
rows=535 | null_district=0 | null_audited=0 | anon_view_rows=535
```

## 5. Fallback adapter smoke — `node scripts/smoke-adapter.mjs`

Committed smoke script; compiles the lib to CJS and runs with Supabase env
absent (static path). **29/29 checks pass**, including the rev 4 additions:

```
Export surface: ScoreLayer, SCORE_LAYERS, SegmentProperties, SegmentCollection,
                SegmentDetail, StreetStats, getSegments, getSegmentDetail,
                getStats — all present; no stale `Stats` export
Runtime exports + SCORE_LAYERS value: ok
getSegments:  FeatureCollection, 535 features; every feature has district,
              audited_at, all four score_* in 0..100, demo=true, real LineString
getStats:     {"segments":535,"km":76.84,"coveragePct":80.3,"heroPct":29}
getSegmentDetail: esc-sa-0001 → district + audited_at strings, scores for all
              layers, 12 observations; unknown id → null
SMOKE PASS
```

## Assumptions / notes for the Conductor

- **535 segments vs a single "corridor".** The bbox covers the whole San Antonio
  district street network (residential/tertiary/secondary/unclassified/footway),
  giving dense, honest demo coverage. Far exceeds the ≥40 bar; all clearly demo.
- **Live DB path is real but unexercised over HTTP.** The `v_segment_scores`
  view is verified via SQL, but the supabase-js client path can't be hit without
  a running PostgREST gateway; the JS mapping is straightforward and guarded by
  graceful fallback (any error → static data).
- **`getSegmentDetail` live path returns `audit: null`** (scores + geometry
  only); observation-level detail over the live DB is left to a later query/unit.
  The static fallback returns full observations today.
- **Admin secret is never committed.** `seed.sql` and `supabase/README.md` carry
  a placeholder + instructions to insert `ADMIN_RPC_SECRET` post-migration.
