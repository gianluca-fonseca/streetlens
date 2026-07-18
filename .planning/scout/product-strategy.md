# Frontier Scout — Product Direction

StreetLens has crossed the line from demo atlas to live civic sensor: a real Escazú walk is on the map, demo scores are dark, and the panel already speaks in provenance, lenses, and Ley 7600 vocabulary. What it still lacks is a **citeable unit of accountability** — something a resident can forward, a journalist can embed, and the Municipalidad can put in a budget packet without opening a GIS app. The next product move is not more map chrome; it is turning each measured segment into a durable public record that travels off the map and forces a conversation about who is failing Art. 125–127, where, and whether a repair actually moved the number.

---

## Ranked proposals

### 1. Shareable Street Report Cards (permalink + OG + copy link)
**What:** Every segment gets a stable URL (`/[locale]/s/[id]` or `/map?segment=esc-sr-0793`) that opens the map focused on that street with the detail panel live; a “Share this street” action copies the link and serves Open Graph / WhatsApp previews with street name, district, four lens scores, and the Ley 7600 pass/fail chip.  
**Why now:** Real data only compounds if people can *point at* a street. Landing rows and hero taps today dump you on a bare `/map` with no selection (`Hero.tsx` `onActivate={openPlatform}`; `AuditMap.tsx` explicitly refuses deep-link infra). Residents share WhatsApp links, not MapLibre sessions.  
**Builds on:** `SegmentDetail.tsx`, `GET /api/segments/[id]/detail`, `getSegmentDetail` / `getSegmentMapDetail`, paint stubs in `lib/map-payload.ts`, landing list in `lib/real-data-era.ts`.  
**Effort:** M · **Risk:** Medium (OG image generation + URL contract; must keep CV vs field-audit honesty on the card)

### 2. Ley 7600 Compliance Brief (municipality-facing)
**What:** A public (or Municipalidad-gated) brief: % of *observed* network failing accessibility &lt; `LEY_7600_MIN_SCORE` (50), district table, ranked failing corridors, map of failing segments, one-page print/PDF export. Copy cites Reglamento Arts. 125–127 the way `docs/method.md` already does. Label CV readings as provisional camera observations until field audits land.  
**Why now:** Landing Gap section already argues “no municipality publishes a compliance map” (`GapSection.tsx` + Ley sidenote). `heroPct` is the compliance headline — but it only counts **audited** rows and reads **0** in the real-data era (`getStats()` in `lib/segments.ts`; `hideAuditedZeros`). The muni cannot act on a silent instrument.  
**Builds on:** `LEY_7600_MIN_SCORE`, `StreetStats.heroPct`, admin district rollup (`app/[locale]/admin/page.tsx`), accessibility lens scores on CV stubs (`cv_accessibility` in `map-payload.ts`).  
**Effort:** M · **Risk:** Medium (political sensitivity of publishing “fail rates”; must not launder CV into audits)

### 3. Before / After when a street is re-walked
**What:** On the report card and panel: when archive exists, show a delta strip — previous walk date + scores → current canonical — with “improved / worsened / unchanged” per lens and a one-sentence change note. Optional “flag as repaired” for muni follow-up.  
**Why now:** Canonical + archive already encode time (`splitCvObservations` in `lib/cv-provenance.ts`; superseded UI in `SegmentDetail`). Without a delta surface, re-walking a fixed street is invisible to press and council — the civic payoff of the second walk never lands.  
**Builds on:** bgsd-0009 provenance model, `captured_on` / `created_at`, archive disclosure copy.  
**Effort:** S–M · **Risk:** Low–Medium (needs clear semantics when only one lens moved)

### 4. Public district comparison (Escazú’s three districts)
**What:** A `/[locale]/districts` (or landing section) comparing San Antonio / San Rafael / Escazú Centro: coverage %, mean overall, Ley 7600 fail rate, camera-observed km — side-by-side, bilingual, linkable.  
**Why now:** Network already has 3 districts × 1457 segments (bgsd-0003); admin privately averages by district; roadmap step “Canton comparison” is still Planned (`RoadmapSection` / `messages/en.json`). District rivalry is how local politics and media notice measurement.  
**Builds on:** `properties.district` on every feature, admin dashboard table, `listRecentlyCvObserved`.  
**Effort:** M · **Risk:** Low (data exists; UI + honest empty states)

### 5. Open data pack (GeoJSON + CSV download)
**What:** Public download of the *published* observed network: geometry, lens scores, source (`cv` / `community` / `audit`), rubric version, captured_on — plus a methodology sidecar. Honor the Grounding claim “Every segment exports with its geometry and its score formula” which today is aspirational (`landing.grounding.openData`).  
**Why now:** Researchers, journalists, and municipal GIS teams will not scrape MapLibre. Open data is the trust layer for CUSP and the Escazú pilot badge.  
**Builds on:** `getSegments()`, scrubbed detail API, paint/privacy diet from bgsd-0011 (`scrubCvObservation` — keep frame_refs out).  
**Effort:** S–M · **Risk:** Low (reuse scrubbing; watch PII / contact fields)

### 6. Deep-link the landing “recently camera-observed” list
**What:** Each CV row opens `/map?segment=<id>` (or report card) instead of a generic platform open — smallest possible step toward report cards.  
**Why now:** You already list real streets by name (`Hero.tsx` + `listRecentlyCvObserved`) but throw away the id on click. That is free product leverage in a real-data era with sparse coverage.  
**Builds on:** Same as #1, subset.  
**Effort:** S · **Risk:** Low

### 7. Contributor coverage challenges (“walk the gap”)
**What:** On map + collect: highlight unobserved corridors near the user / in a chosen district; weekly challenge (“10 more San Rafael segments”); post-approval thank-you that links to the new report card.  
**Why now:** Mission needs contributor growth; funnel exists (`/collect`, contribute modes, `?contribute=1`) but growth loop ends at admin queue — no public “you moved the map” artifact.  
**Builds on:** CV coverage math (`cvCoveragePct`), routing network, capture done screens.  
**Effort:** M · **Risk:** Medium (gamification can clash with zen-instrument tone if loud)

### 8. Embeddable map widget for Municipalidad / press
**What:** A locked iframe or script embed: one district or one corridor, sealed ramps, StreetLens attribution, optional “Ley 7600 fail only” filter — for `escazu.go.cr` or La Nación.  
**Why now:** Municipalidad engagement often starts as “put it on our site,” not “give us an API.” Hero already embeds a live map pattern (`AuditMap` variant `"hero"`).  
**Builds on:** `AuditMap` hero/app variants, paint-only payload, theme tokens.  
**Effort:** M–L · **Risk:** Medium (abuse, styling escape, rate limits)

### 9. Public read API v0
**What:** Versioned `GET /api/v0/segments`, `/stats`, `/districts/:name` returning the scrubbed JSON you already assemble — documented, cached, keyed optionally later. Matches roadmap step `api`.  
**Why now:** After report cards + downloads, API is how other tools (budget systems, disability NGOs) plug in without forking. Detail route is the prototype (`app/api/segments/[id]/detail/route.ts`).  
**Builds on:** Frozen adapter in `lib/segments.ts`, bounded reads, Cache-Control headers already on detail.  
**Effort:** M · **Risk:** Medium (compatibility + abuse; do after scrubbing discipline is proven)

### 10. Municipal work-order packet (“fix this street”)
**What:** From a failing report card: one-click packet — street name, map snapshot, accessibility item failures (width / ramp / slope language from rubric), last walk date, contact for CUSP — printable or emailed to obras.  
**Why now:** Measurement without a path to a work order is journalism; with it, it is governance. Rubric items already map to Ley 7600 figures (`docs/method.md`, `RUBRIC_ITEMS` in `mapConfig.ts`).  
**Builds on:** Report card (#1), item medians on CV observations, assessment text.  
**Effort:** M · **Risk:** Medium (expects a real municipal recipient workflow)

### 11. Field-audit promotion path (CV → published audit)
**What:** Admin action: promote an approved camera observation (with optional on-site verification checklist) into a field-audit score that finally moves `segments` / `heroPct` / official ramps.  
**Why now:** Real-data era honesty currently freezes the compliance headline at 0 until August fieldwork. A controlled promotion path lets early walks become citeable municipal numbers without waiting for a full corridor campaign.  
**Builds on:** Strict separation in `CvObservation` docs (`lib/types.ts`), apply pipeline, scoring.  
**Effort:** L · **Risk:** High (method integrity; must not blur CV and audit)

### 12. Press kit page (bilingual one-pager + assets)
**What:** `/press` with elevator pitch, Ley 7600 framing, latest coverage %, 3 report-card examples, downloadable PNGs of the map, contact — not a blog.  
**Why now:** Pilot narrative is ready (CUSP, Escazú Aug 2026); reporters need a package, not a GitHub README.  
**Builds on:** Landing manifesto sections, sealed renders in `docs/assets/`, report cards.  
**Effort:** S · **Risk:** Low

---

## Top 3 picks

1. **Shareable Street Report Cards** — the atomic civic object for all three audiences.  
2. **Ley 7600 Compliance Brief** — the artifact that books the Municipalidad meeting.  
3. **Before/After on re-walk** — turns the second approval into proof that fixing streets is measurable.

## Bold bet

**Ship the Street Report Card as the product.** Not another dashboard, not “more map features” — a permanent, shareable, Ley-7600-literate page for every measured segment, with before/after when the archive fills in. That single object converts residents into distributors, contributors into authors of a public record, and the Municipalidad into an accountable audience. Everything else (district compare, exports, embeds, API, work-order packets) should hang off that URL.

---

*Out of scope by instruction: bgsd-0011 hardening / cost-pause / payload diet / reviewer UX / CI / real-data landing; bgsd-0012 map theme + score-ramp redesign.*
