# u2-data-layer — PLAN

Unit: data layer (schema, typed adapters, Escazú OSM importer, demo-audit seed generator).
Advisor: rev 1. Scale: feature (full arc). Owns: `supabase/`, `lib/`, `scripts/`, `data/`, `package.json`.

## Validated ground truth (from inspection)

- Next.js 16.2.10 + React 19 + next-intl, Tailwind v4. `strict` TS, `@/*` path alias.
- UI (`components/AuditMap.tsx`, owned by u1) consumes a GeoJSON `FeatureCollection<LineString, SegmentProperties>` where `SegmentProperties = { id, name, score_overall, score_accessibility, score_drainage, score_shade, demo }`. This shape is the hard interop contract — my adapter must emit exactly this.
- `app/[locale]/page.tsx` currently reads `data/demo-segments.geojson` directly via `fs`. I will NOT rewrite the page (u1 territory); I provide `lib/segments.ts` as the adapter u1 wires in. I may keep `data/demo-segments.geojson` as the fallback source so nothing regresses.
- `.env.local` has `ADMIN_PASSWORD` + `ADMIN_RPC_SECRET` only. No `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`. **Live DB confirmed absent → adapter must never block on it.**
- Baseline `npm run build` + `npm run lint` are green before my changes.
- Control CLI phase enum: discuss, ui, plan, execute, verify, fixing, done, blocked, failed. (No "inspect"/"implement" — map to plan/execute/verify.)

## Frozen contract (shared with u1) — exports of `lib/segments.ts`

```
type ScoreLayer = "overall" | "accessibility" | "drainage" | "shade";
getSegments(): Promise<SegmentCollection>          // FeatureCollection<LineString, SegmentProperties>
getSegmentDetail(id): Promise<SegmentDetail | null> // scores + audit + observations + photos
getStats(): Promise<{ segments; km; coveragePct; heroPct }>
```

Signatures identical to u1's placeholder; my internals supersede. Merge conflict on this file is EXPECTED and resolves in my favor.

## Schema ERD (migrations)

```
cantons (id text pk, name, geom polygon?)              -- esc
  └─ districts (id text pk, canton_id fk, name, geom)  -- esc-san-antonio
       └─ corridors (id text pk, district_id fk, name)
            └─ segments (id text pk 'esc-sa-0001', corridor_id, canton_id, district_id,
                          name, highway, length_m, geom GEOMETRY(LineString,4326), demo bool)
rubric_versions (id text pk 'v0.1', label, frozen_at, is_active)
  └─ rubric_items (id text pk, version_id fk, key, label_en, label_es, layer, ordering, response_type)
audits (id uuid pk, segment_id fk, audited_on date, auditor, rubric_version_id fk, demo bool)
  └─ observations (id uuid pk, audit_id fk, item_id fk, response numeric, note)
       └─ photos (id uuid pk, observation_id fk, storage_path, taken_at)
submissions (id uuid pk, type add_segment|update_segment, payload jsonb,
             status pending|approved|rejected, reviewed_at, reviewer_note,
             source_ip_hash, honeypot_tripped, created_at)
app_secrets (key text pk, value text)  -- private, holds admin_rpc_secret; no RLS grant to anon/auth
```

### Migration order (numbered files in `supabase/migrations/`)
1. `0001_extensions.sql` — `create extension postgis`.
2. `0002_geography.sql` — cantons → districts → corridors → segments (+ GIST index on geom).
3. `0003_rubric.sql` — rubric_versions, rubric_items.
4. `0004_audits.sql` — audits → observations → photos.
5. `0005_submissions.sql` — submissions + review metadata.
6. `0006_rls.sql` — enable RLS all tables; public SELECT only on approved/published rows; anon INSERT only into submissions (WITH CHECK status='pending'); no direct anon writes elsewhere.
7. `0007_admin_rpcs.sql` — `app_secrets` (locked down) + SECURITY DEFINER `admin_review_submission(submission_id, action, reason, secret)` and `admin_stats(secret)` validating `secret` against `app_secrets`. No service-role key in this deployment.

`supabase/seed.sql` — generated: rubric v0.1, canton/district/corridor, segments, demo audits/observations. `supabase/README.md` — documents secret-based admin (no service role) + upgrade path.

## Importer — `scripts/import-osm-corridor.mjs`
- Overpass query, bbox San Antonio de Escazú (approx S 9.898, W -84.162, N 9.922, E -84.135), highways `residential|tertiary|secondary|unclassified|footway`, `out geom`.
- Cache raw JSON → `data/raw/overpass-san-antonio.json` (skip refetch if cached, `--refresh` to force). Descriptive User-Agent, single request (rate-limit friendly).
- Split each way polyline into ~150 m block-face segments (haversine cumulative length). Stable ids `esc-sa-0001…`. Emit `data/segments.geojson` (geometry + name/highway/length_m/canton/district + `metadata`: bbox, generated_at, total street km denominator for coverage). Target ≥40 segments.

## Seed generator — `scripts/generate-demo-audits.mjs`
- Deterministic PRNG (mulberry32, fixed seed) → reproducible.
- Per segment, synthetic 0–100 layer scores with spatial autocorrelation:
  - drainage worse near hardcoded quebrada points; accessibility worse on steeper (further-south / uphill) streets; shade smoothly varying value-noise; overall = weighted blend. All clamped 0–100, `demo:true`.
- Outputs: `data/demo-segments.geojson` (scored, UI + getStats source), `data/demo-audits.json` (per-segment audit + observations per rubric item + photo placeholders for getSegmentDetail), and appends demo rows to `supabase/seed.sql`.

## Adapters
- `lib/supabase.ts` — `getSupabaseClient()` returns typed client only when both NEXT_PUBLIC env vars set, else `null`.
- `lib/segments.ts` — reads Supabase when configured; else static fallback from `data/demo-segments.geojson` + `data/demo-audits.json`. getStats: segments=count, km=Σlength/1000, coveragePct from metadata denominator, heroPct = % segments failing Ley 7600 accessibility minimum (score_accessibility < 50).
- `lib/types.ts` — DB row types + adapter types (ScoreLayer, SegmentProperties, SegmentCollection, SegmentDetail, Stats).
- `lib/schemas.ts` — zod schemas for submission payloads (add_segment / update_segment) for the contribution unit.
- Deps: add `@supabase/supabase-js`, `zod`.

## Risks
- Overpass availability/rate limits → cache raw; `--refresh` opt-in; if network hard-fails at verify time, log blocker + note cached response is authoritative.
- No local Postgres → migrations verified by SQL syntax review documented in `.planning/evidence/` (per advisor bar).
- Merge conflict with u1 `lib/segments.ts` placeholder → expected; signatures identical, internals mine.
- GeoJSON foreign `metadata` member: RFC 7946 permits foreign members; MapLibre ignores them.

## Commit sequence (atomic, explicit pathspecs)
1. package.json deps (+lock). 2. lib/types.ts. 3. lib/supabase.ts. 4. lib/schemas.ts. 5. migrations 0001–0005. 6. migrations 0006 RLS. 7. migration 0007 admin RPCs + supabase/README. 8. importer script. 9. generator script. 10. generated data (segments.geojson, demo-segments.geojson, demo-audits.json, data/raw, seed.sql). 11. lib/segments.ts adapter. 12. evidence + verify.
