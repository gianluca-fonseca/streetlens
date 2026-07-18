# Frontier Scout — Data & Insights Surfaces

StreetLens just crossed into measurable reality: one approved camera walk paints live scores on a 1,457-segment canton network while audited headlines correctly read zero. The next unlock is not more capture plumbing — it is **making that accumulating evidence impossible to ignore**. Scores already exist per segment, per lens, with walk-dated provenance and an archive when streets are re-walked; what is missing is the public surfaces that turn those facts into rankings, district rollups, change over time, downloadable truth, and a methodology anyone (including municipal staff) can audit without opening GitHub.

---

## Ranked proposals

### 1. Public Insights page (`/insights`) — the canton instrument panel
**What:** A first-class public route (not the landing hero, not admin) showing live `StreetStats` (CV coverage, sessions, segments), Ley 7600 framing when audits exist, lens switcher with distribution histograms, and deep links into `/map` filtered to the worst / recently walked streets.  
**Why now:** The mission is measurable streets + municipality engagement; today the only aggregate CV story is a mono provenance line and a “recently observed” list. A dedicated insights surface is the place a mayor’s staff can bookmark.  
**Builds on:** `getStats()` / `StreetStats` in `lib/segments.ts` + `lib/types.ts`; `ProvenanceNote`; landing `Hero` / `PilotSection`; `formatCvCoveragePct` in `lib/cv-provenance.ts`.  
**Effort:** M · **Risk:** Medium (must keep CV vs audit counters rigorously separate — the honesty contract already exists).

### 2. Live “worst streets” ranking driven by canonical camera scores
**What:** A ranked list (landing rail + insights) of lowest overall / accessibility scores from **canonical** CV observations, with district, score, walk date, and “open on map.” Replaces the demo-only worst-streets path when `hideAuditedZeros` is true.  
**Why now:** Real-data era already swaps the hero list to `listRecentlyCvObserved` — chronological, not severity. Severity is what makes data undeniable for budget arguments.  
**Builds on:** `Hero.tsx` worst-streets `useMemo` (audit-only); `listRecentlyCvObserved` + `canonicalCvObservation` in `lib/real-data-era.ts` / `lib/cv-provenance.ts`; paint stubs `cv_*` in `lib/map-payload.ts`.  
**Effort:** S · **Risk:** Low (pure read aggregation; label clearly as camera-observed, not field-audited).

### 3. Public district rollups (Escazú × 3)
**What:** Per-district cards: camera-covered km / %, mean canonical scores by lens, Ley failure share when audits exist, link to map bbox or district filter. Promote the admin-only district table to a public, CV-aware version.  
**Why now:** Canton expansion (bgsd-0003) already tagged 1,457 segments across three districts; municipality engagement is district-shaped.  
**Builds on:** Admin district table in `app/[locale]/admin/page.tsx`; `SegmentProperties.district`; network lengths in `data/segments.geojson` via `computeCvCoveragePct`.  
**Effort:** M · **Risk:** Low–medium (admin today averages `score_overall` including zeros/import — public version must use canonical CV or published audits only).

### 4. Segment change-over-time (re-walk deltas)
**What:** When `cv_count > 1`, surface Δ overall / per-lens between canonical and previous walk (sparkline or “−12 since May”), not just an “Archive · past observations” disclosure. Optional map mode: segments that improved / worsened.  
**Why now:** Method docs already promise re-audits as first-class; the data model and UI archive exist — the insight layer does not. Second walks are the moment “did it get fixed?” becomes answerable.  
**Builds on:** `splitCvObservations` / archive UI in `lib/cv-provenance.ts` + `SegmentDetail.tsx`; `CvObservation.scores` + `captured_on`; docs/method.md “Re-audits are first-class”.  
**Effort:** M · **Risk:** Medium (needs ≥2 observations on some segments to demo; empty state must stay honest).

### 5. Open data downloads (GeoJSON + CSV)
**What:** Public `/data` or `/api/export` offering paint-safe scored GeoJSON and a flat CSV (id, name, district, length_m, lens scores, source, captured_on, rubric version). Same privacy scrub as the map wire (no `session_id` / `frame_refs`).  
**Why now:** Landing roadmap already lists “Open API and data” as Planned; researchers and municipal GIS teams cannot engage without files. Real-data era makes the download non-demo.  
**Builds on:** `toPaintFeature` / `scrubCvObservation` in `lib/map-payload.ts`; `getSegments()`; roadmap copy in `RoadmapSection` / `messages/en.json`; existing `application/geo+json` pattern in `app/api/routing-network/route.ts`.  
**Effort:** M · **Risk:** Medium (caching, rate limits, and never shipping frame paths — bgsd-0011 already sealed the paint-only contract).

### 6. Methodology transparency routes (`/method`, `/rubric`)
**What:** Public, localized pages rendering rubric v0.1 items, bins, Ley 7600 threshold (50), sealed ramps, and the CV-vs-audit honesty line — not only `docs/method.md` for developers or an illustrative landing MethodSection with demo anatomy numbers.  
**Why now:** Undeniable data requires explainable data; municipal trust hinges on “how was this scored?” being one click from the map.  
**Builds on:** `docs/method.md`; `LEY_7600_MIN_SCORE`; `RUBRIC_ITEMS` / `BINS` / `RAMP` in `components/mapConfig.ts`; landing `MethodSection` / `MeasureSection`; plates in `public/drawings/`.  
**Effort:** S–M · **Risk:** Low (mostly content + i18n; keep demo plates labeled).

### 7. Coverage progress dashboard (the number that moves)
**What:** A single narrative surface for `cvCoveragePct`: canton bar, district bars, “streets walked this week,” sessions reviewed — explicitly sibling to audited `coveragePct`, never merged.  
**Why now:** ProvenanceNote exists because owners saw “0%” after approval; elevating that moving number is the contributor-growth + ops feedback loop.  
**Builds on:** `StreetStats.cvCoveragePct` + comments in `lib/types.ts`; `formatCvCoveragePct`; `ProvenanceNote.tsx`.  
**Effort:** S · **Risk:** Low.

### 8. Ley 7600 failure lens as a public briefing view
**What:** Accessibility-first view: count/% of camera-observed (then audited) segments below 50, ranked list with map jump, short legal citation strip (Arts. 125–127).  
**Why now:** Accessibility is the enforceable wedge for municipality engagement; `heroPct` already encodes the audited version — extend the concept to the real-data era’s camera scores with clear provisional labeling.  
**Builds on:** `LEY_7600_MIN_SCORE` + `heroPct` in `getStats()`; method Ley section; accessibility ramp.  
**Effort:** S · **Risk:** Medium (political sensitivity — copy must never claim camera scores are legal determinations).

### 9. Canton observation timeline (“what we measured when”)
**What:** Chronological feed of approved walks: date, streets/segments touched, mean scores, link to map. Public cousin of admin submission history, filtered to `cv_capture` approvals.  
**Why now:** Contributor growth needs visible progress; municipality needs a paper trail of measurement activity without admin login.  
**Builds on:** `getSubmissionHistory` / admin `history/page.tsx`; `CvObservation.captured_on` / `session_id` (scrubbed); `cvSessionsReviewed`.  
**Effort:** M · **Risk:** Low–medium (privacy: no contacts, no frame URLs — follow scrub rules).

### 10. Insights deep-link + map query contract
**What:** Stable URLs from rankings into `/map?segment=…&layer=accessibility` (and later `?district=`), so every insight row is one click to the painted street.  
**Why now:** Rankings without spatial proof feel like marketing; the map is already the instrument.  
**Builds on:** `AuditMap` / `SegmentDetail` click path; `/api/segments/[id]/detail`; `MapChrome`.  
**Effort:** S · **Risk:** Low.

### 11. Researcher / municipal CSV “briefing pack”
**What:** One-click export of top-N worst streets + district summary + methodology PDF/HTML snapshot for council packets.  
**Why now:** Engagement often happens offline in meetings; the product should hand them the packet.  
**Builds on:** Same aggregations as #1–3 + method pages #6.  
**Effort:** M · **Risk:** Low (downstream of #1–5).

### 12. Lens distribution charts on insights (not the map)
**What:** Histograms / bin shares (Excellent–Poor from `BINS`) per lens for camera-observed segments — the “shape of the canton” view.  
**Why now:** A single mean hides whether problems are concentrated or systemic; bins already exist in the legend.  
**Builds on:** `BINS` in `mapConfig.ts`; canonical score stubs; `StreetStats`.  
**Effort:** S · **Risk:** Low.

---

## Top 3 picks

1. **Live worst-streets ranking on canonical CV scores** — fastest path from “we walked a street” to “here is what fails,” with almost all primitives already shipped.  
2. **Public Insights page + coverage dashboard** — turns `StreetStats` / ProvenanceNote from footnotes into the product’s second surface after the map.  
3. **Open data downloads (scrubbed GeoJSON/CSV)** — delivers the roadmap’s “Open API and data” promise and lets external actors verify claims independently.

## Bold bet

**Ship “Change over time” as the flagship insight before mass coverage grows.** With canonical vs archive already implemented (`splitCvObservations`), deliberately prioritize a second walk of the same corridor and productize Δ-scores + an improved/worsened map mode. That single narrative — *this street got worse / better since last month* — is more persuasive to municipalities and press than another 50 newly covered segments, and it uniquely leverages StreetLens’s temporal observation model instead of competing with static sidewalk maps.
