# StreetLens Frontier Scout Report
**Lens:** Robustness & platform residue · **Date:** 2026-07-18 · **Post:** bgsd-0011 shipped, bgsd-0012 in flight

## Vision

StreetLens has crossed the credibility threshold: demo data is off, the first real camera walk is approved, and the map paints live CV scores on canton geometry—but the product is still architected like a single-pilot instrument, not a municipal platform. The next build cycle should convert operational residue (full-res frames everywhere, English-only narrative on ES streets, hand-mirrored DB types, no backup discipline) into **repeatable walk throughput** and **trust artifacts municipalities can hold**. bgsd-0011 closed the worst security and reviewer-loop gaps; bgsd-0012 fixes the visual language. What remains is the substrate for walk #2–#20: cheaper bytes, bilingual signal, observable pipelines, and a canton model that doesn't hardcode `esc-*` forever.

---

## Ranked Proposals

### 1. Frame derivative pipeline (thumb + model JPEG)
**What it is:** At frame register/finalize, write two companions beside each full-res JPEG: `thumb-NNNN.jpg` (~192–256 px for filmstrip/replay) and `model-NNNN.jpg` (512 px for extraction). Admin filmstrip, lightbox default, and the pump read derivatives; full-res stays for inspector/lightbox zoom only.

**Why now:** Walk #1 proved the funnel; walk #2 at 200–400 frames will crush admin mobile bandwidth and serverless pump CPU re-fetching and re-sharping every original (`lib/extraction/downscale.ts`, `lib/capture/pump.ts:107`).

**Builds on:** `app/api/capture/sessions/[id]/frames/route.ts`, `lib/capture/storage.ts`, `components/admin/CaptureReview.tsx:1468–1477` (96×72 `<img>` still points at full `frame.url`), existing `sharp` + `FRAME_MAX_EDGE_PX` in `lib/extraction/downscale.ts`.

**Effort:** M · **Risk:** Medium — storage layout migration for in-flight sessions; must not break model URL contract.

---

### 2. Locale-aware camera assessments (Spanish public copy)
**What it is:** At synthesis (or a post-synthesis translate step at review), produce `assessment_es` alongside the English `assessment`. Public `SegmentDetail` renders locale-appropriate prose; hide the "written in English" disclaimer on ES.

**Why now:** Escazú's primary audience reads Spanish; the most narrative public content on a CV street is still English model prose (`components/SegmentDetail.tsx:296–313`, `messages/es.json:125` `cvAssessmentNote`).

**Builds on:** `lib/extraction/synthesis.ts`, `lib/capture/schemas.ts` (`segmentAssessmentSchema`), `SegmentDetail` CV block, review approve path in `app/api/admin/capture/review/route.ts`.

**Effort:** M–L · **Risk:** Medium — translation quality/consistency; schema migration for bilingual JSONB; token cost per segment.

---

### 3. Private capture bucket + signed URLs
**What it is:** Flip `captures` bucket to private; serve frames via short-lived signed URLs for extraction worker, admin review, and status page. Public map already scrubs `session_id`/`frame_refs` (`lib/map-payload.ts`); this closes the remaining "UUID = capability" leak for unapproved walks shared via WhatsApp.

**Why now:** bgsd-0011 fixed map wire privacy, but `lib/capture/storage.ts:4–8` still documents public-read-by-design; anyone with a session link can enumerate `captures/<uuid>/frame-NNNN.jpg`.

**Builds on:** `supabase/migrations/0013_capture.sql` bucket policy, `publicFrameUrl()`, pump `prepareImage`, `StatusClient` capability URLs.

**Effort:** M · **Risk:** Medium–High — breaks direct model URL fetch pattern; requires server-mediated signing in pump and review-store.

---

### 4. Pipeline observability & operator alerts
**What it is:** A lightweight ops surface: `/api/health/pipeline` + structured metrics (stale `running` jobs, `cost_paused` age, daily token spend, queue depth) and webhook/email alerts when thresholds breach. Admin banner when extraction is fleet-paused.

**Why now:** Real-data era has no Sentry/Datadog; failures surface as `console.warn` in pump (`lib/capture/pump.ts`) and a daily cron only (`vercel.json`). Operators discovered cost-pause dead-ends manually once already.

**Builds on:** `capture_reclaim_stale_jobs` / `capture_resume_cost_paused` (0025/0027), `FrameInspector` `jobStatus`/`jobError` fields, `app/api/admin/capture/resume/route.ts`, existing admin chips in `QueueList.tsx`.

**Effort:** M · **Risk:** Low — mostly additive; avoid alert fatigue with sane defaults.

---

### 5. HMM sparse-coverage softening (`minTraversalFrames`)
**What it is:** For short segments (&lt;X m) or sparse sampling, allow 1–2 frame traversals to report with low-coverage rollup instead of silently dropping them from `reported` (`DEFAULT_MIN_TRAVERSAL_FRAMES = 3`).

**Why now:** Real Escazú residential blocks walked at video cadence can vanish entirely from scoring—not "low confidence," but never extracted (`lib/matching/hmm.ts:84`, `997–1001`). Undermines "measurable streets" on the very geometry contributors walk.

**Builds on:** `lib/matching/hmm.ts`, finalize → `no_segment_match` path, reprocess tooling (`scripts/reprocess-capture-session.mjs`).

**Effort:** M · **Risk:** Medium — false-positive segment attribution on noisy GPS; needs telemetry (`below_min_frames` vs off-network).

---

### 6. Supabase generated types + typed client
**What it is:** `npm run db:types` → `lib/database.types.ts`; wire `createClient<Database>()`; retire hand-mirrored row types where generated types suffice. CI check that types are fresh vs migration checksum.

**Why now:** Migrations through 0027; `lib/supabase.ts:41–43` is untyped `SupabaseClient`; `lib/types.ts:310` and `lib/capture/types.ts` manually mirror SQL—column drift only fails at runtime.

**Builds on:** `supabase/migrations/`, `lib/supabase.ts`, all `client.rpc()` / `.from()` call sites.

**Effort:** M · **Risk:** Low — incremental adoption; some RPC return shapes still need Zod at the edge.

---

### 7. Extraction cost envelope completion
**What it is:** (a) Record billed tokens on failed/refusal/overbudget paths, not only `completeJob` success; (b) cap synthesis fan-out (max segments/evidence chars per session, fold synthesis into session budget); (c) fleet-pause on `insufficient_quota` without burning attempts (`lib/extraction/client.ts:76–83` fast-fails retries but pump still terminal-fails jobs).

**Why now:** Vision spend is guarded; synthesis is not (`lib/capture/pump.ts:414–502`, `lib/extraction/synthesis.ts`). Pathological sessions undercount spend in review UI; empty OpenAI balance can terminal-fail entire queues.

**Builds on:** `capture_session_token_usage` RPC, `lib/extraction/config.ts`, pump drain stages.

**Effort:** M · **Risk:** Low–Medium — behavior changes on budget accounting must be tested against 0025 resume semantics.

---

### 8. Paginated capture review payload
**What it is:** Split `capture_session_review` into summary (rollups, assessments, job counts) + cursor-paginated frames (`?after=seq&limit=50`). Inspector fetches single-frame detail on select.

**Why now:** Admin page loads entire walk JSON in one RPC merge (`lib/capture/review-store.ts:440–449`); at 400 frames this is multi-MB TTFB before filmstrip even starts fetching images (#1).

**Builds on:** `0022_segment_synthesis.sql` review RPC, `CaptureReview` filmstrip, `FrameInspector`.

**Effort:** M · **Risk:** Medium — UI state across pages; must preserve draft persistence (`loadReviewDraft`).

---

### 9. Multi-canton tenancy scaffold
**What it is:** Replace hardcoded Escazú paths (`data/canton-import-segments.json`, `esc-*` id prefix) with env-driven `CANTON_ID` + `data/cantons/<id>/network.geojson` import. Segment adapter filters by canton; landing copy parameterized. DB already has `canton_id`/`district_id` on `SegmentRow` (`lib/types.ts:331–335`).

**Why now:** Roadmap promises canton comparison (`messages/en.json:836–843`); geometry is canton-wide but code assumes a single frozen import. Needed before Santa Ana / neighboring pilots.

**Builds on:** `lib/segments.ts` (`IMPORT_SEGMENTS_PATH`, `getSegments`), `lib/map-payload.ts`, i18n pilot sections.

**Effort:** L · **Risk:** Medium — data migration + URL/routing strategy (`/[canton]/map` vs query param).

---

### 10. Backup, export & municipality data room
**What it is:** Documented ops runbook + scripts: `pg_dump` schedule, GeoJSON/CSV export of published scores + CV observations (scrubbed), segment network bundle per canton. Optional admin "Export canton snapshot" for municipal meetings.

**Why now:** Zero backup/export discipline in repo; municipality engagement requires artifacts they can open in QGIS/Excel without Supabase dashboard access. Real-data era makes data loss unacceptable.

**Builds on:** `lib/segments.ts` live readers, `community_cv_observations` table, `getStats()` aggregates, sealed ramp tokens in `components/mapConfig.ts`.

**Effort:** M · **Risk:** Low — mostly scripts/docs; watch PII (contact fields) in exports.

---

### 11. Re-run synthesis after reviewer curation
**What it is:** Workbench button: when frames are excluded/overridden, re-invoke synthesis on the corrected evidence set (same ±`CV_SYNTHESIS_MAX_ADJUST` bounds), replace stale assessment text, token-accounted. Removes "written before your corrections" limbo.

**Why now:** Queued as bgsd backlog item (#13 / issue #13); first real walk will get human corrections; published map prose should match curated numbers.

**Builds on:** `lib/capture/review-overrides.ts` live recompute, `lib/extraction/synthesis.ts`, `CaptureReview` stale hints.

**Effort:** M · **Risk:** Low — bounded scope; reuse existing synthesis client.

---

### 12. Community contact persistence
**What it is:** Add `contact` column to `submissions` (admin-only read); pass through `submit_proposal` RPC. Mirror CV's contact pattern (`capture_sessions.contact`, `0024`).

**Why now:** `ContributeUI.tsx` collects contact; `app/api/submissions/route.ts:97–104` persists only `type` + `payload`—contributors expect follow-up, admins see nothing.

**Builds on:** `lib/schemas.ts:86–92`, `lib/submissions-sink.ts`, `submit_proposal` in `0026_security_core.sql`.

**Effort:** S · **Risk:** Low — PII handling already solved for CV path.

---

## Top 3 Picks

1. **Frame derivative pipeline (#1)** — Unblocks the second real walk operationally; pairs directly with paginated review (#8) as walk length grows. Highest bytes-per-dollar ROI left on the table.

2. **Locale-aware camera assessments (#2)** — The public map now tells a Spanish municipality a story in English. Fixing this is the difference between "interesting pilot" and "instrument Escazú can cite."

3. **Pipeline observability (#4)** — You cannot scale contributor growth on a funnel you discover is stuck via SQL. Cheap insurance now that cost-pause/resume exists but nobody is paged when it trips.

## Bold Bet

**Municipality Data Room (combine #9 + #10 + #2):** Ship a canton-scoped, bilingual, exportable snapshot—live map + ES assessments + downloadable GeoJSON/CSV + backup runbook—as the deliverable for Escazú's first municipal briefing. Not another admin feature: a **trust artifact** that turns StreetLens from a web app into infrastructure a canton can adopt, compare, and archive. The code already has canton geometry, provenance chips, and scrubbed public payloads; what's missing is the packaged outbound face.

---

*Excluded (shipped bgsd-0011/0012 or in flight):* PostgREST bypass closure, map paint-only payload, cost-pause resume, stale-job reclaim, CI/`npm test`, reviewer throughput (next-in-queue, street names, shortcuts, drafts), real-data landing composition, map theme/ramp redesign, `MapChrome`, deferred hero `AuditMap`, lazy DEM on 3D toggle.
