# The CV data-collection funnel

A contributor films a street. We place the frames on the street network, ask a
vision model to score them against the same rubric a human field auditor uses,
and hand the result to a reviewer.

This document is the map of that pipeline and the reference for its contracts.
It is written by the foundation unit (u25); sections marked **filled by later
units** are stubs whose owning unit is named.

## Why it exists

A field audit is one person, one clipboard, one street at a time: thorough,
slow, and hard to scale past a district. A capture is a walk with a phone. If a
capture can produce rubric v0.1 scores that a reviewer trusts, coverage stops
being bounded by auditor-hours.

The whole design follows from one constraint: **CV output is a proposal, not
data.** It enters the same review queue a manual contribution does, and nothing
it produces reaches the published map without a human approving it. Every
decision below that looks conservative is downstream of that.

## The pipeline

```
  phone ──1─▶ POST /api/capture/sessions          → sessionId (the capability)
        ──2─▶ POST .../[id]/frames                → registers frames, authorizes upload
        ──3─▶ PUT  storage/streetlens-frames/...  → bytes, direct to storage
        ──4─▶ POST .../[id]/finalize              → attaches track, enqueues jobs

  server ─5─▶ lib/matching                        → track → segment traversals
         ─6─▶ POST /api/capture/pump              → claims jobs, extracts, writes observations
         ─7─▶ rollups                             → per-segment medians
         ─8─▶ review                              → submissions row (type cv_capture)
```

Status moves: `pending_upload → uploading → matching → extracting → review_ready
→ approved | rejected`. Off-path: `cost_paused` (extraction budget exhausted;
frames intact, a human resumes it; a stop, not an error) and `failed`
(terminal).

## Contracts

Everything below has ONE definition, and this doc points at it rather than
restating it. If a shape here disagrees with the code, the code is right and
this doc is stale.

| Concern | Source of truth |
| --- | --- |
| Types (track, frames, session, observation) | `lib/capture/types.ts` |
| Runtime validation | `lib/capture/schemas.ts` |
| Map matching interface | `lib/matching/types.ts` |
| Tables, RPCs, storage policy | `supabase/migrations/0013_capture.sql` |
| Submission type vocabulary | `supabase/migrations/0014_submission_types.sql` |
| Upload orchestration | `lib/capture/upload-client.ts` |

### The rubric is not a new vocabulary

A `CaptureObservation` carries exactly the 15 rubric v0.1 items a human auditor
scores (`scripts/generate-demo-audits.mjs`). That is deliberate: a CV
observation and a field audit must be comparable item-for-item, or the two data
sources cannot live on one map. `scripts/test-capture-schemas.mjs` parses the
keys out of the generator, so a rubric change that forgets `lib/capture` fails
loudly rather than drifting.

Encodings: boolean → `0|1`, `scale_0_4` → `0..4`, percent → `0..100`. Higher is
always better.

`null` is a first-class value meaning **not assessable from this frame** (the
pole is out of shot, the crossing is behind the camera). It is not a zero.
Rollups skip it; scoring it would quietly punish a street for being
photographed from the wrong angle.

### Attribution is not the model's job

`CaptureObservation` deliberately carries **no `segmentId` and no
`nearJunction`**. Those are derived from the track by `lib/matching`. A model
can say what it sees; it must never assert where it was. Leaving the fields off
the shape makes that mistake unrepresentable rather than merely discouraged.

### Storage paths

`captures/<session-uuid>/frame-<seq, 4 digits>.jpg`, from
`captureFrameStoragePath()`. Zero-padded so paths sort in capture order.

The path is **derived server-side** from the seq. A client-supplied path is
ignored, because a client-chosen path is the entire attack surface of a bucket
that accepts anonymous inserts.

## Security model

There is no service-role key in this deployment. Access to the capture tables
follows the pattern established in `0007_admin_rpcs.sql`:

- Every capture table is **RLS-on with zero policies**, so anon cannot touch them
  at all. The SECURITY DEFINER RPCs are the only way in.
- **Privileged** RPCs (claim/complete/fail a job, write rollups, move status)
  authenticate `ADMIN_RPC_SECRET` against `app_secrets`.
- **Public** RPCs (create session, register frames, finalize, read status) are
  anon-callable but **capability-scoped**: knowing a session's uuid authorizes
  acting on that session and nothing else. The role is never what is trusted.

This is stricter than `0006_rls.sql`, where the published reference tables are
world-readable open data. A capture in flight is unreviewed contributor data
carrying ip hashes and contact details, so the status RPC returns only what a
progress view needs and never those.

### Registration is authorization

The bucket's insert policy admits an object only when a `capture_frames` row
already exists for that exact path on a session that still accepts uploads.
Registering frames (not holding the anon key) is what lets bytes land.

### Sealed tradeoff: the bucket is public-read

`streetlens-frames` is public-read, 2 MB/object, `image/jpeg` only, with no
update or delete policy (frames are write-once).

The unguessable session uuid in the path IS the capability: the bucket cannot be
enumerated, and the review UI and the extraction model can fetch a frame without
signing every URL. Revisit if captures ever carry faces or plates that survive
to storage.

### Rate limiting, in two places on purpose

3 sessions/hour/IP, enforced both in `lib/rate-limit.ts` (the `capture`
namespace) and inside `capture_create_session`. The in-memory bucket resets on
every cold start, so it rejects cheaply but does not actually hold; the database
check is the one that does.

## Map matching

`lib/matching/types.ts` is the authoritative interface. `lib/matching/index.ts`
picks the active implementation. Import from `lib/matching`, never from an
implementation file, and the swap costs no call-site changes.

Today that implementation is `baseline.ts`, which snaps each fix to the nearest
segment within a 30 m gate and smooths consecutive runs. It has no topology and
no transition model, so it is knowingly weak at parallel streets, junctions and
teleports. unit-hmm-map-matching replaces it; `scripts/test-matching-baseline.mjs`
is written against the interface, so those cases should pass for the HMM too.

> **Footgun.** `data/segments.geojson` carries a `metadata.bbox` in Overpass's
> **lat-first** order, which is not the GeoJSON convention. Reading it
> transposes every gate check into the ocean. Compute bboxes from geometry. A
> test asserts the file is still lat-first so this warning cannot go stale.

## Cost

Five guards, each enforced where it can actually stop spending.

| Guard | Ceiling | What happens |
| --- | --- | --- |
| Kill switch | `CV_EXTRACTION_ENABLED` ≠ `"true"` | The pump no-ops before claiming. Finalize still matches and enqueues, so flipping it back on drains the backlog. |
| Per-frame tokens | 2600 input tokens | Job → `failed_overbudget`, session → `cost_paused`, that session stops yielding work. |
| Per-session budget | frames × 1500 input tokens | Session → `cost_paused` with its jobs back on `pending`. |
| Escalation | 10% of a session's frames | Further low-confidence frames keep the cheap model's answer. |
| Attempts | 3 claims per job | Job → `failed`. |

The per-frame ceiling is the one that matters most, and it is the reason the
guard exists at all. `detail: "low"` should cap an image around 85 tokens, but a
provider that ignores the hint and bills full resolution still returns a
perfectly normal-looking 200 — nothing about the response looks wrong, and a
400-frame session quietly costs orders of magnitude more. The only way to notice
is to assert the tokens we were actually billed, on every response, including
refusals and truncations. `lib/extraction/extract.ts` checks it before it even
parses the answer: an over-budget response that happens to contain good JSON is
still over budget.

`cost_paused` is a deliberate stop, not an error. The frames survive and a human
resumes the session.

### The pump and its cron

`POST /api/capture/pump` claims ≤ 40 jobs with `FOR UPDATE SKIP LOCKED`
(`capture_claim_jobs_with_frames`, 0015) and runs them at `p-limit(8)`. Racing
pumps are the ordinary case — an `after()` kick and a cron tick will overlap —
and the lock is what makes that safe, so no frame is ever billed twice.

It is called by finalize's `after()`, by the cron, or by an operator. It is
**gated on `ADMIN_RPC_SECRET`** (or Vercel's `CRON_SECRET`), because each call
can bill 40 model requests. A session uuid does not authorize it: the uuid
capability lets you act on your own session, not start work on the whole queue.
The contributor's status page therefore cannot pump, and should not — that would
put an unbounded model bill behind an anonymous GET that anyone can hold open in
a tab.

`vercel.json` schedules a **daily** sweep (`0 3 * * *`) as a backstop for
sessions whose `after()` kick died mid-flight. Daily is a plan constraint, not a
design preference: **Hobby allows only daily cron, and per-minute schedules
require Pro.** The queue does not depend on it — `after()` drains a session
immediately — so the cron is a safety net, and on Pro it is worth tightening to
`* * * * *` for prompt retries.

## Review

**Filled by unit-capture-review.** A finished session enters the existing queue
as a `submissions` row of type `cv_capture` with payload `{session_id}` (0014).

Two hooks are already in place for it. `cv_capture` has no payload schema in
`lib/submissions.ts` yet, so such rows are **counted but not renderable**: the
admin queue looks exactly as it did. And `toApplyInput()` returns `null` for
it, so a capture cannot fall through the community-segment apply pipeline by
accident. That unit decides what approving a capture does.

## Video mode

**Filled by unit-video-ingest.** `mode: "video"` and the `mp4box` dependency
exist; frame extraction from an uploaded file and its clock alignment are that
unit's.

## Testing

Run these directly with node; none need a live database.

| Script | What it locks |
| --- | --- |
| `scripts/test-capture-schemas.mjs` | contracts, rubric sync, encodings, path convention |
| `scripts/test-matching-baseline.mjs` | the matching interface against synthetic tracks |
| `scripts/test-capture-migrations.mjs` | 0001..0014 applied to a throwaway container, every RPC exercised |
| `scripts/test-upload-client.mjs` | retry, resume, concurrency, abort |
| `scripts/test-rate-limit-namespaces.mjs` | capture ceiling, namespace isolation |
| `scripts/test-honeypot-type.mjs` | the honeypot preserves the submitted type |

`test-capture-migrations.mjs` needs docker and **never touches the live
database**. It applies the whole chain to a scratch container running the real
Supabase Postgres image, then destroys it. It skips cleanly when docker is
absent.
