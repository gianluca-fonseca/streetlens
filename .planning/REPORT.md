# unit-pipeline-truth — REPORT

**Verdict: PASS** — All four mandates implemented with migration 0025, server/UI/CLI wiring, fail-loud data modes, tests green, and browser evidence on port 3571.

## Commits

| Hash | Message |
|------|---------|
| `4995630` | feat(db): add pipeline-truth migration for resume and stale reclaim |
| `7c5efcc` | feat(capture): resume cost_paused sessions and persist pause reason |
| `9880844` | feat(admin): surface job errors, pause reason, and resume control |
| `67d302d` | fix(data): fail loud on configured live-read and apply RPC errors |
| `d715513` | feat(i18n): honest cost_paused vs transient failure copy (EN/ES) |
| `b9c6090` | test: pipeline-truth gates for resume, apply hard-fail, and migrations |
| `1d20021` | evidence: browser-drive screenshots for unit-pipeline-truth |

## Gate results

```
npx tsc --noEmit
→ exit 0

npm run lint
→ exit 0

npm run build
→ exit 0 (Next.js 16.2.10 compiled successfully)

node scripts/seed-provenance-drive.mjs --clean
→ exit 0

scripts/test-*.mjs (31 files)
→ all exit 0 (including test-pipeline-truth.mjs, test-capture-migrations.mjs 0025 block)

node scripts/test-i18n-parity.mjs
→ PARITY: OK (identical key sets)
```

## Migrations

| # | File | What it does | Server depends? |
|---|------|--------------|-----------------|
| 0025 | `0025_pipeline_truth.sql` | Adds `pause_reason`/`resume_*` columns; `capture_reclaim_stale_jobs`; `capture_resume_cost_paused`; reclaim prologue in claim RPCs; `pause_reason` on `capture_session_status`; per-frame `jobStatus`/`jobError`/`jobAttempts` on `capture_session_review`; extended `capture_set_session_status` with `p_pause_reason` | **Yes** — resume API, CLI, pump pause writes, review/status reads assume these RPCs/columns exist |

**Conductor must apply 0025 before deploy.** Local dev against live Supabase without 0025 will error on new RPC calls.

## Mandate coverage

1. **cost_paused RESUME PATH** — `capture_resume_cost_paused` RPC; `POST /api/admin/capture/resume`; `scripts/resume-cost-paused-session.mjs`; admin resume banner on `CaptureReview`; `pause_reason` persisted via extended `capture_set_session_status`.
2. **STALE JOB RECLAIM** — `capture_reclaim_stale_jobs` + prologue in both claim RPCs (>10 min `running` → `pending`); pump route comment corrected.
3. **OPERATOR OBSERVABILITY** — Review frames expose `jobStatus`/`jobError`/`jobAttempts`; pause reason in workbench + contributor status; EN/ES copy distinguishes budget pause vs terminal failure.
4. **FAIL-LOUD MODES** — `lib/segments.ts` logs live failures and sets `stats.dataRead.degraded`; `DataDegradedBanner` on map/landing; `applyApprovedCaptureSession` hard-fails when configured RPC fails.

## Assumptions

- Migration 0025 is applied by the conductor on the shared Supabase instance (not applied in this worktree).
- `capture_session_review` frame job fields require the migration; until applied, live review may omit job metadata (fixture path unaffected).
- No `cost_paused` session existed in live DB during evidence drive; resume UI is code-complete and migration-tested; status screenshots show review_ready session with updated copy.

## Deviations

- `scripts/test-panel-vitality.mjs` section 5 updated from byte-unchanged whole-file diff to sealed-string spot-checks, because this unit must change mandated i18n copy (finding 14). Parity remains enforced by `test-i18n-parity.mjs`.
- Evidence drive could not screenshot a live `cost_paused` session (none in DB); admin review + status pages demonstrate observability and copy on a `review_ready` walk.

## Evidence

`.planning/evidence/unit-pipeline-truth/`:

- `map-en.png` — public map (port 3571)
- `landing-en.png` — landing hero/map embed
- `admin-queue.png` — verification queue
- `admin-capture-review.png` — review workbench with live session
- `status-review-ready-en.png` — contributor status (EN)
- `status-review-ready-es.png` — contributor status (ES)
- `console.log` — browser console capture from review drive
