# unit-quality-privacy — VERDICT: PASS

All three SECURITY-RELEVANT mandates shipped: bilingual camera assessments (EN+ES in one synthesis call), private `streetlens-frames` bucket with signed-URL access, and a public evidence strip served only via scrubbed, time-limited signed URLs (empty/`unavailable` when signing is not available). Gates green; migration `0028` SQL-only (conductor applies).

## Commits

| Hash | Subject |
|------|---------|
| `b02b3fbbd32bba105890d4ee0ebf560579f90d1f` | feat(privacy): add migration 0028 for bilingual assessments and private frames |
| `69e98d3bf06a00c205b912b47954d47fce6d2363` | feat(synthesis): emit EN+ES assessment prose in one bounded call |
| `86357a625265de0f3e46a7c099531c3e9675e2e0` | fix(evidence): guard null rows from bounded frame_refs fetch |
| `25114f70e184f6b6a05e7695eaebf27e275e1830` | fix(cv): fall back when assessment_es column is not yet migrated |
| `b2a5b11f369f8d9d2b9dfcde33cff96f278b4138` | fix(cv): cast dynamic select results through unknown for supabase types |
| `09b1483cfcfa4d0d3e05718a91f9c43a8ae8745d` | fix(privacy): require 7-arg assessment RPC and update migration tests |
| `1103729d3e336f7deed608d9b559f4a3ab3d5274` | fix(privacy): re-privatize frames bucket after 0013 idempotency re-run |
| `21e99554d371146c3ad5856334dd2d191306f8a1` | feat(ui): show evidence strip on CV segments and commit drive evidence |
| `772e4371ac385231598ade7d5af7b33365ae82e0` | test(privacy): align bucket-private assertion with 0028 upsert form |

(Final docs commit for REPORT/CONTROL/gates may follow this file.)

## Gates (verbatim)

npx tsc --noEmit: PASS
npm run lint: PASS
npm run build: PASS
npm test (after seed-provenance-drive --clean): PASS (42/42)
node scripts/test-i18n-parity.mjs: PASS

## Migrations created

- `supabase/migrations/0028_quality_privacy.sql` — single file, two clearly sectioned concerns:
  - **A. Locale-aware camera assessments** — sibling column `assessment_es jsonb` on rollups + `community_cv_observations` (prose map `{ overall, lenses }`); `capture_set_segment_assessment` becomes 7 required args (`p_assessment_es` nullable); apply/review RPCs updated.
  - **B. Private capture-frame bucket** — upsert `streetlens-frames` with `public = false` + loud DO assert; anon SELECT narrowed to paths present on published `community_cv_observations.frame_refs` (`capture_frame_evidence_readable` / `capture_frames_evidence_select`). Contributor INSERT/signed upload path unchanged.

### Design justification (assessment storage)

Kept frozen English `assessment` Zod shape on the wire and added **`assessment_es` as a sibling column** (not a locale map inside `assessment`). Reasons: (1) English-only historical rows keep working with zero reshape; (2) EN remains the synthesis/audit canonical; (3) public UI picks via `assessmentOverallForLocale` with EN fallback when ES is missing; (4) avoids breaking existing consumers that parse `assessment` as the frozen object.

### Design justification (private frames + evidence)

Bucket flipped private. Unapproved frames require `SUPABASE_SERVICE_ROLE_KEY` signed URLs (admin + extraction pump). Public map/detail still scrub `session_id` / `frame_refs`. Public evidence is only via `GET /api/segments/[id]/evidence`, which mints short-lived signed URLs for policy-allowed paths; if signing fails or no service role, the strip returns `{ frames: [], emptyReason: "unavailable" }` — **never raw public frame URLs**. That is the safest visible alternative when privacy conflicts with showing pixels (no blurred thumbnails fabricated from inaccessible bytes).

## Assumptions

- Conductor applies migration `0028` to live Supabase; this unit never writes live DB.
- Pre-migration live DBs may lack `assessment_es`; select path falls back so the app does not hard-fail before apply.
- Local evidence drive without service-role signing correctly shows empty/`unavailable` strip (privacy-safe).
- Scale doctrine: synthesis prompt parameterized as municipality pilot — no new Escazú/canton hardcodes.

## Deviations

- Evidence strip placed under the **CV block** (not only non-community streets) so import/community camera streets show it.
- When signing is unavailable, strip is empty with i18n `photoUnavailable` / held copy rather than blurred placeholders (cannot blur what we refuse to fetch).
- Migration-test harness re-applies `0028` after `0013` idempotency (0013 resets bucket public); production apply order is linear so 0028 wins once.

## Evidence list

Port **3585** — `.planning/evidence/unit-quality-privacy/`:

- `map-detail-en.png` — EN assessment + photos strip state
- `map-detail-es.png` — ES assessment + fotos strip state
- `console.log` — browser console (MapLibre null warnings pre-existing; no app errors)
- `drive.log` — API + Playwright drive summary
- `gates.txt` — gate results mirror

Scout specs implemented: `.planning/scout/robustness-residue.md` #2 (locale assessments), #3 (private bucket); `.planning/scout/ui-elevation.md` #2 (evidence strip).
