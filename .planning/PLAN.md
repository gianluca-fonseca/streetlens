# PLAN — u7-upload-pipeline

Base: `next` @ d046e41+. Branch `unit/u7-upload-pipeline`. All rulings sealed by the Conductor advisor directive (rev 1). Honesty is the spine: approved contributions ENTER the dataset as **community, unverified** segments/reports with **no fabricated scores**, excluded from official stats.

## Mental model (from inspection)

- Data layer: `lib/segments.ts` (getSegments/getSegmentDetail/getStats), static demo fallback (535 features, `demo:true`); frozen `SegmentProperties`/`StreetStats` in `lib/types.ts`, shared with u1 AuditMap.
- Submissions: `lib/submissions.ts` (read + reviewSubmission), local overlay/staging files (gitignored). `lib/submissions-sink.ts` (u3 write path — not ours). `lib/schemas.ts` zod payloads.
- Admin UI: `app/[locale]/admin/{page,queue,login}`; server pages gated by `proxy.ts` (matcher excludes `/api`); `components/admin/{StatTiles,StatusBadge,AdminHeader,QueueList,...}`. Panel recipe: `rounded-[8px] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]`. Fonts: font-display / font-sans / font-mono. Tokens in `app/globals.css`.
- Map: `components/AuditMap.tsx` (MapLibre, source `segments`, `promoteId:"id"`, two line layers glow+line). Ramp colors centralized in `components/mapConfig.ts` (`RAMP`, `lineColorExpression/lineWidthExpression` — DO NOT TOUCH). Detail panel `components/SegmentDetail.tsx` (client, `useTranslations("detail")`, reads clicked feature props directly).
- i18n: next-intl v4; `messages/{en,es}.json`; EN drives the `Messages` type (`global.d.ts`); ES mirrored manually in lockstep. Locales `en`/`es` (es = es-CR conventions, voseo).
- DB: migrations 0001–0011; secret-gated `SECURITY DEFINER` RPCs (0007/0010); RLS public-read reference tables; `supabase/README.md`. No test framework — node-level `.mjs` scripts compile TS→CJS (see `scripts/smoke-adapter.mjs`).

## Design decisions

1. **New feature props (contract v3, additive/optional):** `SegmentProperties` gains `source?: "audit"|"community"|"import"`, `verified?: boolean`, `community_report?: CommunityReport`, `community_reports?: CommunityReport[]`. Additive optional → existing 535 constructors unaffected; demo features get `source:"audit", verified:true` backfilled in `enrichFeature`/`rowToFeature`. `StreetStats` gains `communitySegments: number`.
2. **Community segment = no scores.** Applied add_segment → a segment feature with all `score_*:0`, `demo:false`, `source:"community"`, `verified:false`, an embedded `community_report` derived from the contributor note (NOT scores). Rendered with neutral warm-grey dashed casing; excluded from the score-ramp line layer; excluded from `stats.segments`; counted in `stats.communitySegments`.
3. **Applied update_segment = a community report** attached to the target existing segment (`community_reports.local.json` / `community_reports` table), surfaced in the panel ("Community report · date · note"). NEVER a score mutation.
4. **One apply pipeline: `lib/apply-submissions.ts`.** Used by both admin approve and bulk import. Local mode → `data/community-segments.local.json` + `data/community-reports.local.json` (gitignored), merged into `lib/segments.ts` read path. DB mode → RPC `admin_apply_submission(p_submission_id, p_secret)` (migration 0012).
5. **Bulk import `/admin/import`:** upload GeoJSON (FeatureCollection of LineStrings) or CSV → **dry-run first** (per-feature zod validation, bbox check, id dedupe vs existing segments, count summary, zero side effects) → explicit "Import N features" commit through the same pipeline with `source:"import"` and `verified` per an admin checkbox (+ auditor name when verified).
6. **Counter fix (ruling 5):** make submission counts derive from ONE reconciled effective-status source in `lib/submissions.ts` (overlay wins, else base-file status), so a file-status-rejected record lacking an overlay entry is still counted. Lock with a node test (fixture record `abbdc33e`).

## Commits (atomic, pathspec-scoped)

1. `feat(types): contract v3 — community segment/report shapes + import zod schemas` — lib/types.ts (optional feature props, CommunitySegment/CommunityReport, communitySegments deferred), lib/schemas.ts (import feature + CSV row schemas).
2. `i18n(admin): community-segment + import strings (EN + es-CR)` — messages/en.json, messages/es.json (detail.community*, admin.import.*, admin.nav.import, legend/map community label).
3. `feat(apply): single community-apply pipeline (add→segment, update→report, import)` — lib/apply-submissions.ts.
4. `feat(segments): merge community segments/reports into adapter read path (contract v3)` — lib/segments.ts, lib/types.ts (StreetStats.communitySegments + getStats).
5. `fix(admin): reconcile submission counts to a single source of truth` — lib/submissions.ts.
6. `feat(admin): route approvals through the community-apply pipeline` — lib/submissions.ts.
7. `feat(map): render community segments with neutral dashed casing` — components/mapConfig.ts, components/AuditMap.tsx (+ Legend if cheap).
8. `feat(detail): community chip + community reports in segment panel` — components/SegmentDetail.tsx.
9. `feat(admin): bulk import page — dry-run preview + commit` — app/[locale]/admin/import/page.tsx, components/admin/ImportPanel.tsx, components/admin/AdminHeader.tsx (nav union).
10. `feat(admin): import API route (dry-run + commit, session-gated)` — app/api/admin/import/route.ts.
11. `feat(db): migration 0012 — community tables + admin_apply_submission RPC` — supabase/migrations/0012_community.sql.
12. `docs(supabase): document community tables + admin_apply_submission (0012)` — supabase/README.md.
13. `chore: gitignore community-apply local files` — .gitignore.
14. `test(apply): node-level apply + dry-run import + counts tests` — scripts/test-apply-submissions.mjs, scripts/test-import-dryrun.mjs, scripts/test-submission-counts.mjs.
15. `test(smoke): extend adapter smoke for community exclusion + communitySegments` — scripts/smoke-adapter.mjs.

(Order keeps each commit compiling: messages before components that reference new keys; StreetStats field + getStats together.)

## Verification bar (report verbatim)

- `npx tsc --noEmit` green
- `npm run lint` (eslint) green
- `npm run build` (Next 16 / Turbopack) green
- smoke: `node scripts/smoke-adapter.mjs` — 535 official + demo intact; `communitySegments` counted; community excluded from the 535
- apply test: `node scripts/test-apply-submissions.mjs` — add_segment fixture → segment in adapter output flagged community/unverified, no scores; update_segment → report attached to target
- dry-run test: `node scripts/test-import-dryrun.mjs` — valid file → preview counts; invalid rows → per-row errors, zero side effects
- counts test: `node scripts/test-submission-counts.mjs` — file-status-rejected record w/o overlay counted as rejected, excluded from pending
- migration 0012 verified in a PostGIS container if cheap

## Boundaries

OWN: lib/apply-submissions.ts, lib/segments.ts contract-v3 additions, lib/types.ts/schemas.ts additions, migration 0012, admin import page + apply wiring, community-segment map rendering, messages, node tests.
DO NOT TOUCH: contribute UI/trace logic, mapConfig score ramps (RAMP + ramp expression builders), existing migrations.
