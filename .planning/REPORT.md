PASS — Paint-only map payload, bounded Supabase reads, deferred landing map, lazy DEM, on-demand ISR, and click-time SegmentDetail all shipped with gates green.

## Commits

| Hash | Message |
|------|---------|
| `1ced615` | feat(map): paint-only public payload and bounded segment detail API |
| `4d9c2a8` | feat(map): click-time detail fetch, deferred hero map, lazy DEM |
| `7a4f9cf` | feat(admin): revalidate map pages immediately on approval |
| `c78b219` | test: lock paint-only payload contract and update apply suites |
| `6981007` | evidence: browser-drive unit-map-diet on port 3573 |

## Gate results

```
npx tsc --noEmit → exit 0
npm run lint → exit 0
npm run build → exit 0 (Next.js 16.2.10, 30 static pages)
node scripts/seed-provenance-drive.mjs --clean → clean
scripts/test-*.mjs (32 files) → ALL TESTS PASS
node scripts/test-i18n-parity.mjs → PARITY: OK (identical key sets)
```

## Migrations

None created. Server code uses existing `community_cv_observations` and `v_segment_scores` tables with bounded `.range()` pagination; no migration dependency.

## Mandate coverage

1. **Paint-only map payload** — `getSegments()` emits paint features via `toPaintFeature()` (`lib/map-payload.ts`): ids, casings (`source`), `cv_count`, canonical CV score stubs (`cv_*`), no `cv_observations`, `session_id`, or `frame_refs` on the wire.
2. **Bounded selects** — `fetchAllPages()` (`lib/supabase-bounded.ts`) paginates `liveScoreRows` and `liveCvObservations`; per-segment detail capped at 50 rows with truncation logging.
3. **Landing defer** — `Hero.tsx` uses `next/dynamic(() => import('@/components/AuditMap'), { ssr: false })`.
4. **Lazy DEM** — `AuditMap.tsx` removes `setupTerrain` from style load; DEM + hillshade added inside `applyThreeD(true)` only.
5. **Freshness** — `revalidatePublicMapPages()` called from admin review routes on approve; `revalidate = 300` unchanged on landing/map pages.
6. **SegmentDetail** — fetches `GET /api/segments/[id]/detail` on click; canonical/archive/panel-vitality intact via scrubbed observations (`frame_count` replaces `frame_refs`).

## Assumptions

- Public detail endpoint is sufficient for panel data; admin paths that called `getSegments()` for full blobs do not need inline `cv_observations` (paint + detail fetch covers map UX).
- `NEXT_PUBLIC_SHOW_DEMO_DATA` off in local dev shows neutral network (0 audited stats) but map still renders; evidence captured on port 3573 with live CV stats from local store when present.

## Deviations

- None.

## Evidence

- `.planning/evidence/unit-map-diet/map-loaded.png`
- `.planning/evidence/unit-map-diet/landing-hero.png`
- `.planning/evidence/unit-map-diet/map-3d-enabled.png`
- `.planning/evidence/unit-map-diet/console.log`
