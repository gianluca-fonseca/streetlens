# StreetLens Frontier Scout — Contributor Capture Lens

## Vision

StreetLens has crossed the credibility threshold: the first real camera walk is approved, demo scores are hidden, and the public map now shows what volunteers actually measured. The bottleneck is no longer pipeline plumbing — it is **repeatable, high-quality contribution at scale**. A stranger who scans a QR on a lamppost must understand in 30 seconds what to do, get live reassurance that they are walking correctly, survive a 20-minute Escazú block without hitting silent caps, and return after upload to see *their* streets named and eventually credited. The capture stack (`/collect`, OPFS durability, resumable uploads, status polling) is production-grade; the next wave is **guidance, continuity, and recognition** layered on top of that engine.

---

## Ranked Proposals

### 1. Lamppost QR + targeted `/collect` deep links

**What it is:** Physical QR codes (and shareable URLs) like `/collect?street=esc-sr-0793&source=qr` that open a **mission brief**: street name, district, a mini-map of the target segment, “walk this block,” then one tap into live record. Stranger onboarding in three screens, not a generic chooser.

**Why now:** Real-data era needs hyperlocal recruitment — municipality can sticker lampposts on streets with zero observations. Landing “Activate” today only routes to `/map` (`Hero.tsx` `openPlatform`), not capture.

**Builds on:** `CollectClient.tsx` mode gate; `TraceMap.tsx` / `TrackMiniMap.tsx` MapLibre patterns; `lib/capture/segment-label.ts` naming; segment geometry via `getSegments()` / `app/api/segments/[id]/detail/route.ts`; map already supports `?contribute=1` on `/map` (`app/[locale]/map/page.tsx`).

**Effort:** M  
**Risk:** Medium — needs a **public, bounded** segment lookup (name + bbox only, no PII); QR print collateral is ops, not code.

---

### 2. In-walk quality coach (live drop-reason feedback)

**What it is:** During recording, translate `dropCounts` into plain coaching on the HUD: “Phone hasn’t moved — keep walking,” “Too blurry — wipe lens / slow down,” “No GPS — step outside.” A small quality meter (frames kept vs. camera frames seen) so contributors know *while walking* whether the session is usable.

**Why now:** Bad walks waste reviewer time and erode trust after the first real success. Drop reasons exist post-walk on `ReviewScreen.tsx` but are invisible during capture; `gating.ts` + `RecordingHUD.tsx` already compute the underlying signals.

**Builds on:** `useRecorder.ts` (`stats.dropCounts`, 1 Hz `publishStats`); `DROP_REASONS` + i18n `collect.drops.*` in `messages/en.json`; `CAPTURE_TUNING.accuracyWarnM` pattern for GPS warnings in HUD.

**Effort:** M  
**Risk:** Low–medium — copy must avoid false confidence; thresholds in `tuning.ts` are explicitly **uncalibrated** (needs field tuning pass).

---

### 3. “My walks” shelf + automatic status bookmarking

**What it is:** Device-local history (no account): after upload, persist `{ sessionId, submittedAt, mode, distance, frameCount }` in `localStorage`; a **My walks** section on `/collect` and status page with one-tap return. Optional “email me this link” using the existing optional contact field.

**Why now:** Status URLs are the only capability token (`StatusClient.tsx`); contributors lose links, can’t find past submissions, and have no reason to revisit. Review drafts already use `localStorage` (`lib/capture/review-draft.ts`) — same pattern, contributor-facing.

**Builds on:** `DoneScreen.tsx` / `VideoDoneScreen.tsx` session handoff; `upload-client.ts` resumable upload + `sessionId`; `StatusClient.tsx` poll contract.

**Effort:** S  
**Risk:** Low — privacy stays local-first; clear “this device only” copy.

---

### 4. Street-named status rollups (not raw segment IDs)

**What it is:** On `/collect/status/[id]`, show “Calle X · 73% covered” instead of `esc-sr-0793`. When approved, link to the public map segment. Optional provisional score preview after extraction (clearly labeled “pending review”).

**Why now:** Post-upload engagement is the retention loop; raw IDs are engineer-facing. Admin already has `formatSegmentTitle()` (`lib/capture/segment-label.ts`); status API returns only `segmentId` in rollups (`app/api/capture/sessions/[id]/route.ts`, `StatusClient.tsx`).

**Builds on:** Extend `capture_session_status` RPC or enrich GET route with public segment names; reuse `formatSegmentTitle`; map deep-link to segment detail.

**Effort:** S  
**Risk:** Low — must not leak admin-only fields; scores stay provisional until approval (per `docs/cv-funnel.md`).

---

### 5. Long-walk chaptering at frame/duration caps

**What it is:** When `sessionCapReached` fires (`frame_cap` / `duration_cap`, 400 frames / 30 min in `CAPTURE_LIMITS` + `tuning.ts`), guide the contributor to **finish part 1, upload, start part 2 from here** with a map pin at the stop point and copy explaining multi-part walks. Optional “link parts” metadata for reviewers.

**Why now:** Escazú canton segments can exceed ~2.4 km of kept frames at 6 m spacing; first real walk proved viability — next volunteers will hit caps on arterials.

**Builds on:** `useRecorder.ts` cap handling + `ReviewScreen.tsx` cap notices; `closeSegment` / multi-segment tracks in `engine/session.ts`; `video-plan.ts` already sparsifies long videos.

**Effort:** M  
**Risk:** Medium — reviewer UX for chained sessions needs a light admin grouping story.

---

### 6. Pre-upload quality gate (“ready to send?”)

**What it is:** Before upload CTA on `ReviewScreen` / `VideoReviewScreen`, a checklist: ≥ N frames, GPS accuracy distribution, % dropped by reason, track length vs. network. Block upload with fixes (“almost all frames dropped for displacement — you may have been stationary”) or warn-only for borderline walks.

**Why now:** Matching and extraction cost real money post–bgsd-0011; rejecting bad walks *before* upload saves ops and contributor disappointment on `failed` status.

**Builds on:** `ReviewScreen.tsx` dropped-frame table + `totalDropped`; `stats.trackPoints` floor; `lib/matching/` gate concepts; upload rejection path already exists (`uploadError.rejected_*`).

**Effort:** M  
**Risk:** Low — heuristics must stay advisory where uncertain; i18n for ES parity.

---

### 7. Video-in-progress recovery card at mode chooser

**What it is:** Mirror live-walk recovery (`CollectClient.tsx` OPFS scan) for video: “You have a video half-read — pick the same file to continue” with frame progress, surfaced on chooser *and* `VideoStartScreen`.

**Why now:** Video extraction is minutes on device (`useVideoUpload.ts` checkpoints); recovery exists only after re-picking the identical file — invisible to contributors who land on the chooser.

**Builds on:** `isResumableExtraction` + `listManifests()` in `useVideoUpload.ts`; `looksLikeVideoSession` filter pattern from `CollectClient.tsx`; `VideoExtractScreen.tsx` resume messaging (`resumedFrom`).

**Effort:** S  
**Risk:** Low — file identity is `(name, size, lastModified)`; honest collision copy already documented in hook comments.

---

### 8. Opt-in public contributor credit

**What it is:** At review upload, optional display name + checkbox “Show my name on the map if approved” (default off). Approved observations could show “Filippo · community walk” instead of generic “Community contributor” (`docs/cv-funnel.md` anonymity rule).

**Why now:** Recognition drives repeat contributors; municipality partnerships want to celebrate locals. Contact email exists but is admin-only and non-public.

**Builds on:** `ReviewScreen.tsx` / `VideoReviewScreen.tsx` contact field; `capture_sessions.contact`; `sanitizeContact` / provenance in `lib/cv-provenance.ts`; `SegmentDetail.tsx` contributor attribution pattern.

**Effort:** M  
**Risk:** **High (privacy/consent)** — needs explicit publish consent, GDPR-style clarity, ES copy, and DB migration; default must stay anonymous.

---

### 9. Approval / decision notifications

**What it is:** If contact email provided, send one transactional email at `approved` / `rejected` / `cost_paused` with status link and street summary. No marketing list.

**Why now:** Status page says “you can close this page” but offers no callback when review finishes — contributors disappear during the slowest phase.

**Builds on:** `StatusClient.tsx` terminal states; session lifecycle in `lib/capture/types.ts`; contact on `createSession` (`lib/capture/db.ts`); admin resume for `cost_paused` (bgsd-0011, admin-only — contributor still needs a ping).

**Effort:** M  
**Risk:** Medium — email deliverability, PII handling, rate limits; must not expose session data in email beyond the existing capability URL.

---

### 10. Interactive 10-second practice walk

**What it is:** Optional pre-walk step after `StartScreen`: record ~10 s, show kept vs. dropped frames and holding-angle hints, then discard and start for real. Reduces first-walk failure rate for QR strangers.

**Why now:** `StartScreen.tsx` is text-only (“portrait, forward, normal pace”); iOS permission denials are irreversible if asked cold — practice adds a low-stakes gesture before the real walk.

**Builds on:** `useRecorder.ts` phase machine; `GateScreens` / `RecoverScreen` patterns; same gating pipeline without upload.

**Effort:** S  
**Risk:** Low — must not pollute OPFS with practice manifests (separate local id or auto-discard).

---

### 11. Live mini-map + “on network” hint during recording

**What it is:** Collapsible map overlay on `RecordingHUD` showing GPS trace against the street network; gentle nudge when fixes drift >25 m from any segment (“you may be off the mapped streets — walk the sidewalk on the line”).

**Why now:** Upload rejection for out-of-area walks is heartbreaking after 20 minutes (`uploadError.rejected_*`); GPS warnings today are accuracy-only (`RecordingHUD.tsx`).

**Builds on:** `TrackMiniMap.tsx`; `TraceMap.tsx` segment tiles; `lib/matching/graph.ts` (would need a **lightweight client subset** or bbox API); `haversineMeters` in `engine/geo.ts`.

**Effort:** L  
**Risk:** Medium–high — bundle size (MapLibre already lazy-loaded per mode); offline graph slice maintenance.

---

### 12. Background upload continuation

**What it is:** After upload starts, register a `beforeunload` warning *and* optional Service Worker / `Background Sync` to resume `uploadCapture` if the tab is killed mid-batch — contributor gets a notification-style banner on return.

**Why now:** `upload-client.ts` is resumable but `ReviewScreen` requires the tab open (`upload.keepOpen`); bus rides and phone calls still kill uploads.

**Builds on:** `uploadCapture` idempotent re-register (`lib/capture/upload-client.ts`); OPFS frame store (`engine/opfs.ts`); manifest `sessionId` reuse in `useRecorder.ts` upload path.

**Effort:** M  
**Risk:** Medium — SW support varies on iOS Safari; fallback stays current “keep open” path.

---

## Top 3 Picks

1. **Lamppost QR + targeted `/collect` deep links** — Only proposal that turns physical municipality presence into measured streets; closes the gap between landing interest and the recorder.  
2. **In-walk quality coach** — Biggest lever on evidence quality per walk; uses data you already collect, visible only at review today.  
3. **My walks + street-named status rollups** — Cheap continuity layer that makes the async review loop feel personal and worth returning to.

## Bold Bet

**Live “survey mode” map overlay:** During recording, snap the walker’s position to the Escazú network in real time, highlight the segment they are covering, grey out off-network drift, and show a rolling coverage bar per street (“Calle Rohrmoser — 40% of segment frame budget”). This turns `/collect` from a blind camera app into a **guided street survey instrument** — the product story municipalities will fund. Technically it extends `RecordingHUD` + a client-side graph slice (`lib/matching/graph.ts`, `TraceMap.tsx`), but it is the highest-integration bet on the list; ship QR onboarding and the quality coach first to feed it trained walkers.
