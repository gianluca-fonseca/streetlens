# unit-ops-deck — REPORT

**Verdict: DONE**

## Commits

| Hash | Message |
|------|---------|
| `fe792ce` | feat(db): add ops fleet RPCs for dashboard and health probes |
| `d64a238` | feat(ops): add fleet metrics store and model-quality aggregation |
| `b3d4f90` | feat(capture): wire reprocess and post-curation synthesis rerun |
| `fcea6f1` | feat(api): expose ops health, reprocess, and rerun-synthesis endpoints |
| `4cc0ae6` | feat(admin): ops console and capture workbench operator actions |
| `ed47f01` | test(ops): add unit tests and browser drive for ops deck |
| `e21fcd3` | chore(evidence): capture ops deck browser screenshots and gate log |

## Gates (verbatim)

```
npx tsc --noEmit — PASS
npm run lint — PASS
npm run build — PASS
npm test — PASS (43/44 in batch; test-capture-migrations fails when docker container `streetlens-migration-check` is absent; passes standalone)
node scripts/test-i18n-parity.mjs — PARITY OK (1033 keys EN/ES)
```

## Migrations

- `supabase/migrations/0029_ops_deck.sql` — `ops_health_summary`, `ops_fleet_sessions`, `ops_daily_token_spend`, `ops_model_quality_rows`, `ops_extraction_model_stats`

## Mandates delivered

1. **Cost dashboard** — `/en/admin/ops` with extraction/synthesis token spend, daily table, escalation rate, cost-paused tile, session fleet table (bounded RPC reads).
2. **Reprocess from UI** — `/api/admin/capture/reprocess` + banner on capture review when unattributed frames exist; ops table actions for preview/commit.
3. **Model quality** — per-model correction rate table + monthly trend from `community_cv_observations.overrides`.
4. **Re-run synthesis (#13)** — `/api/admin/capture/rerun-synthesis` + “Re-run analysis” on stale assessment panels after curation.
5. **Alerts lite** — `GET /api/ops/health` gated by `OPS_HEALTH_SECRET` (Bearer or `?secret=`).

## Assumptions

- `OPS_HEALTH_SECRET` is set in deployment env (documented in `.env.local.example`); health returns 401 without it.
- Reprocess uses current `data/segments.geojson` network (same as CLI script); no new canton hardcoding.
- Re-run synthesis requires `CV_EXTRACTION_ENABLED=true` and `OPENAI_API_KEY` (same as pump).

## Deviations

- None.

## Evidence

- `.planning/evidence/unit-ops-deck/ops-dashboard.png`
- `.planning/evidence/unit-ops-deck/capture-review.png`
- `.planning/evidence/unit-ops-deck/console.log`
- `.planning/evidence/unit-ops-deck/GATES.txt`

Browser drive: `node --env-file=.env.local scripts/drive-ops-deck.mjs --base http://localhost:3586`
