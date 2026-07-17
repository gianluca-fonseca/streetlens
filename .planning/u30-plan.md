# u30 — review loop integration: plan

Validated against the worktree on 2026-07-16. The seed holds. Four deviations are
recorded below, each forced by something in the code that the seed could not have
known. Everything else follows the seed as written.

## The invariant

Approval never mutates audit data. CV observations are a THIRD community record
kind, merged at read time next to community segments and reports, tallied
separately in stats, and rendered as visibly provisional. `demo-audits.json` and
the GeoJSON are never written. `stats.segments` must stay 535.

## What the code already decided for us

The prior units left this unit named seams, not guesses:

- `lib/submissions.ts:326` — `toApplyInput` returns `null` with
  "cv_capture: unit-capture-review owns what approving a capture does."
- `lib/submissions.ts:173` — `PAYLOAD_SCHEMAS.cv_capture = null` with
  "unit-capture-review gives cv_capture a schema and a card."
- `0014_submission_types.sql` — the type CHECK already admits `cv_capture`, and
  the header fixes the payload as `{"session_id": "<uuid>"}` with the capture data
  staying in `capture_*`, not copied into the payload.
- `capture_set_session_status` (0013:636-638) already stamps `reviewed_at` for
  `approved|rejected`. The RPC exists; the caller does not.

## Deviations from the seed (each forced, each documented)

### D1 — the status page must not POST /api/capture/pump

The seed asks for pump-on-poll against `/api/capture/pump`. That route
(`app/api/capture/pump/route.ts:19-26`) requires `Bearer ADMIN_RPC_SECRET|CRON_SECRET`,
fails closed when neither env is set, and carries a written rule that the status
page must never call it because a browser cannot hold the secret.

Resolution: a new **session-scoped** pump, `POST /api/capture/sessions/[id]/pump`.
It authorizes with the same capability the rest of the public capture surface
already uses (the unguessable session uuid, sealed in 0013:191-197), drains only
that session's jobs, and is IP rate-limited. The secret-gated global pump is left
exactly as it is. This achieves the seed's intent (keep Hobby-plan processing
moving while a contributor watches) without handing the browser a secret.

### D2 — capture needs a read-side local fallback for the review page

The seed offers a choice: verify with local fallback + fixture frames, or live DB
with demo rows. Neither exists today. Capture has no local mode at all
(`getCaptureDb()` returns null → every capture route 503s, `lib/capture/db.ts:350-357`),
and the live path for approval needs migration 0017, which only the Conductor may
apply. So both offered options are currently closed.

Resolution: `lib/capture/review-store.ts` — one read model for the review page
(`SessionReview`), live via RPCs, falling back to `data/capture-review.local.json`,
mirroring the exact idiom `lib/segments.ts` already uses (`liveScoreRows()` else
the demo collection). Local mode is what the node tests and the Playwright drive
use. Write paths are unaffected: recording still requires the live DB and still
503s without it.

### D3 — the live approve path needs its own RPC, not admin_apply_submission

`admin_apply_submission` (0012:144-145) ends in
`else raise exception 'unsupported submission type'`, and the TS catch at
`apply-submissions.ts:171` swallows any RPC error and falls through to the local
store. So a cv_capture approved against the live DB would silently write to local
files and look like it worked. That is the worst failure mode available.

Resolution: migration **0017** adds `community_cv_observations` + a definer RPC
`admin_apply_capture_session(p_session_id, p_segment_ids, p_reason, p_secret)` that
does the whole approval atomically (insert observations, set session status, close
the submission row). `admin_apply_submission` is left untouched — CV approval is
per-segment and never fits its per-submission shape. **The Conductor applies 0017;
this unit writes the file and flags it in the control file. No DDL is run here.**

### D4 — rollups do not carry the cost/quality metadata the review page needs

`SegmentRollup` (`lib/capture/rollup.ts:55-70`) carries only segmentId, 5 lens
scores, item medians, coverage, confidence. The seed's review page wants frame
count, token totals, and escalated/failed/overbudget indicators. Those live in
`capture_session_status` + `capture_session_token_usage` + `capture_frame_jobs.status`.

Resolution: `review-store.ts` joins them. No change to `SegmentRollup` — u29 owns
that type and the rollup path is deliberately ignorant of the map.

## Queue integration: emit, not derive

The seed asks us to choose and say why. **Emit** a `cv_capture` submission row at
rollup completion.

Why: 0014 already specified the row and its payload, so the schema author intended
emission. Emission reuses the submissions lifecycle wholesale (pending/approved/
rejected, the review overlay, `getSubmissionCounts`, the queue read path); deriving
from `review_ready` sessions would fork a second queue concept and let
`session.status` and submission status drift apart with no single source of truth.

Ordering, which is load-bearing: `rollupSession` (`lib/capture/pump.ts:355-386`)
sets `review_ready` at :384, and the drain predicate only selects `extracting`, so
that write is the idempotency latch — once it lands the session never re-drains.
Emitting *after* it means a throw loses the submission forever. So we **emit before
the status write**, and make the emit idempotent (check-then-insert on
`payload->>'session_id'`, hardened by a partial unique index in 0017) because
emitting before the latch means a crash in between re-emits on the retry.

An all-failed session (zero rollups) still reaches `review_ready` by design. It
still emits: a session where every frame failed is exactly a thing a human should
see and close, and the review page renders it as such.

## Commits

1. types/schemas: `CvObservation`, cv_capture payload schema, `PAYLOAD_SCHEMAS` entry
2. community-store + apply-submissions: the `cv_observation` kind, `upsertById` idempotency
3. segments.ts: read-time merge + `getSegmentDetail` + `getStats` counts
4. parse-feature-props: `parseCvObservations`, wired into `parseFeatureProps`
5. pump: emit the cv_capture row before the review_ready latch
6. review-store: the live/local read model
7. migration 0017 (file only; Conductor applies)
8. admin API: `/api/admin/capture/review`, cookie re-verified in-route
9. session-scoped pump route (D1)
10. admin queue: the cv_capture card
11. admin review page: map, rollup cards, filmstrip, cost readout, actions
12. SegmentDetail CV section + map layer chip
13. collect/status page: poll + pump-on-poll
14. i18n EN+ES, tests, evidence

## Verification bar

tsc/lint/build green. Node tests for apply idempotency + merge + the 535 invariant,
extending `scripts/test-apply-submissions.mjs`. Regression: re-run
`test-parse-feature-props.mjs` (we touch it), `test-apply-submissions.mjs`,
`test-submission-counts.mjs`, `test-capture-rollup.mjs`, `test-extraction-worker.mjs`.
Playwright drive in local mode over the fixture session. Screenshots 390 + 1440,
EN + ES, light + dark for public surfaces. Evidence under `.planning/evidence/u30/`.
