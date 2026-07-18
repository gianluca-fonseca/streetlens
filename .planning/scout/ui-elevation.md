# Frontier Scout — Visual & Brand Elevation

StreetLens just crossed into the real-data era with a sealed Zen Instrument system (Space Grotesk / Newsreader / Plex Mono, flash-pink signal, glass-over-tiles only). The map, panel, and landing already *work*; what they lack is the last mile of presence: streets you can deep-link and share as civic artifacts, a hero that reads as brand-first at manifesto scale, dark mode that feels curated rather than inverted, and evidence imagery that replaces the dashed `ImageOff` placeholders. Build the shareable street surface and the brand will carry the municipality and contributor loops with it.

---

## Ranked proposals

### 1. Segment permalink + OG “street card”
**What:** Deep-link `/[locale]/map?seg=<id>` (or `/s/<id>`) that opens the map focused on that segment with the detail panel already open. Server-rendered Open Graph / Twitter card: mono street name, district, ramp-ink overall score, pink CV chip register, Escazú lockup — generated via `ImageResponse` (or a static template fed live props). One tap “Copy link / Share” in the panel header.
**Why now:** Real walks exist; municipalities and walkers share streets on WhatsApp before they visit a homepage. Without OG imagery (`generateMetadata` today is title/description only in `app/[locale]/page.tsx`), every share is a blank preview.
**Builds on:** `SegmentDetail.tsx` (instrument panel), `app/[locale]/map/page.tsx` (`contribute=1` already proves searchParams), paint-safe public props in `lib/map-payload.ts`, score ink helpers in `components/scoreColor.ts`.
**Effort:** M · **Risk:** Low–medium (URL state + cache for OG; keep frame URLs out of public OG).

### 2. Kill the photo placeholders — public evidence strip
**What:** Replace the three dashed `ImageOff` tiles under “photos” with a privacy-safe strip of approved walk frames (or a deliberate “frames held for review” empty). On tap: lightbox reused from admin (`FrameLightbox` patterns), reduced-motion fade. Never put `frame_refs` back on the map GeoJSON wire.
**Why now:** The panel looks unfinished exactly where trust should peak. Real camera evidence is the product; placeholders undermine the real-data claim.
**Builds on:** Placeholder grid in `SegmentDetail.tsx` (~649–671), deferred detail fetch + `app/api/segments/[id]/detail/route.ts`, scrubbed `frame_count` in `lib/map-payload.ts` / 0011 privacy diet, admin `FrameLightbox.tsx`.
**Effort:** M · **Risk:** Medium (privacy + signed URLs + retention; do not reopen paint-only leak).

### 3. Dark mode as a first-class brand look
**What:** Treat dark as the showcase: theme-aware static plates (`public/render/atlas-dark.svg` exists unused), landing figures swap light/dark assets with the class theme, CTA inverted band and hero settle tuned for near-black, optional “dark by default on `/map`” once 0012 lands. Keep pink signal + ramp chroma as the only loud color.
**Why now:** Theme switcher + tokens are done (`ThemeSwitcher`, `lib/theme.ts`, panel dark elevation in `panel.module.css`), but the manifesto still ships light-only SVG plates and unused dark atlas art — dark feels like a toggle, not a look.
**Builds on:** `docs/design-direction.md` (“black zen”), `app/globals.css` `:root.dark`, `panel.panelScope` elevation ladder, `public/render/atlas-dark.svg`.
**Effort:** M · **Risk:** Low (asset duals + QA; defer live basemap theme sync to 0012).

### 4. Hero brand scale + type rhythm pass
**What:** Restore brand-first hierarchy on the first viewport: larger wordmark / question (closer to sealed Thesis H1 scale in `design-direction.md`), tighten left-rail mono vs serif roles, keep the live map as FIGURE 1. Align section H2 / lead / body steps across `SectionHeader`, Hero, and CTA so the page has one metronome.
**Why now:** Hero H1 is `clamp(1.35rem…1.6rem)` while section titles run larger — after removing the brand lockup, the first viewport could belong to any map product. Brand test fails.
**Builds on:** `components/landing/Hero.tsx`, `components/ui/SectionHeader.tsx`, type tokens in `app/globals.css` / `app/[locale]/layout.tsx` (Space Grotesk, Newsreader, Plex Mono).
**Effort:** S · **Risk:** Low (copy layout only; respect mobile law).

### 5. MapPanel for the CV-first era
**What:** Redesign the floating instrument so primary readout matches real-data composition: camera-observed km / segments / coverage as hero when audited zeros are hidden; fail-rate only when field audits exist. Same glass Recipe A, mono numerics, ProvenanceNote as first-class — not a footnote under a misleading `0%`.
**Why now:** Landing already branches on `hideAuditedZeros` (`Hero.tsx`); `MapPanel.tsx` still leads with `stats.heroPct` fail rate. Instrument and story disagree.
**Builds on:** `MapPanel.tsx`, `ProvenanceNote.tsx`, `lib/real-data-era.ts`, landing CV stat stack in `Hero.tsx`.
**Effort:** S–M · **Risk:** Low.

### 6. Manifesto real-data storytelling (copy + figures)
**What:** One storytelling pass: mission/FAQ/open-data strings that still say “demo until August 2026” where real walks are live; Method “TABLE 1” anatomy swaps illustrative 73/41/… for a live approved segment (or clearly labeled sample from real geometry); Pilot figure caption cites the first approved walk. Keep honesty rules — no fake field audits.
**Why now:** Visual elevation without narrative elevation leaves the page sounding pre-launch. Real-data era is a messaging moment.
**Builds on:** `MissionSection`, `MethodSection` (hardcoded `ANATOMY_*`), `PilotSection`, `messages/en.json` + `es.json` landing namespaces, `getStats()` / CV provenance.
**Effort:** M · **Risk:** Low (i18n parity; careful claim language).

### 7. Wire the unused Reveal system + landing ma
**What:** Apply `Reveal` to manifesto sections (once-only opacity + 8px rise already authored). Add 2–3 intentional beats only: section hairline draw, figure mat settle, CTA invert crossfade. No child stagger storms.
**Why now:** Motion tokens and `.sl-reveal` live in `globals.css`; `components/ui/Reveal.tsx` exists; **no landing section imports it**. The motion system is half-shipped.
**Builds on:** `Reveal.tsx`, `--dur-*` / `.sl-reveal` / reduced-motion block in `app/globals.css`, existing hero `.sl-hero-el` cascade.
**Effort:** S · **Risk:** Low.

### 8. Empty states as directed instruments
**What:** Replace mono-box empties (hero list, admin queue, contribute, photo strip) with one empty vocabulary: mono eyebrow, one Newsreader sentence, one pink-underline CTA (“Record a walk” / “Add a street”). Same hairline plate, no illustration kitsch.
**Why now:** Sparse real data is normal early; empties are the onboarding surface for contributors.
**Builds on:** `Hero.tsx` `segments.empty`, `QueueList` / `HistoryList` empty strings, `SegmentDetail` photo placeholders, `messages/*/admin|landing|contribute`.
**Effort:** S · **Risk:** Low.

### 9. Capture Done → shareable walk receipt
**What:** After upload, Done screen becomes a small instrument receipt: session id (mono), segment count pending review, map thumbnail of the matched corridor, “Share status link” + “Walk another.” Status page gets the same visual register as the landing (serif lead, mono meta).
**Why now:** Contributor growth needs a proud moment between walk and approval. Today `DoneScreen.tsx` is competent but forgettable.
**Builds on:** `DoneScreen.tsx`, `StatusClient.tsx`, `TrackMiniMap` / `TraceMap`, collect i18n.
**Effort:** M · **Risk:** Low.

### 10. Landing → map handoff with focus theater
**What:** Worst-street / CV rows on the hero push `/map?seg=<id>` (same as #1) and trigger a short reduced-motion-safe fly-to + selection pulse (feature-state already exists). No ramp or basemap theme work.
**Why now:** Hero list already calls `openPlatform` with no segment context (`Hero.tsx`); the click feels like abandoning the story.
**Builds on:** `AuditMap` selection / `feature-state` hover+selected, hero corridor fly constants, map `searchParams` pattern.
**Effort:** S–M · **Risk:** Low if sequenced after 0012 theme fix (avoid paint collisions).

### 11. Theme-aware Measure / Pilot plates
**What:** Re-run or dual-publish `public/render/lens-*.svg` and `district-san-antonio.svg` for dark zen; `<picture>` / CSS swap on `.dark`. Keeps FIGURE vocabulary while dark mode stops flashing light maps into a black page.
**Why now:** Complements #3 without touching live MapLibre (0012’s lane).
**Builds on:** `MeasureSection.tsx`, `PilotSection.tsx`, `scripts/render-map-images.mjs` (per design-direction), existing render assets.
**Effort:** S–M · **Risk:** Low.

---

## Top 3 picks

1. **Segment permalink + OG street card** — highest leverage for municipality engagement and organic growth.  
2. **Public evidence strip in the panel** — finishes the instrument where trust lives; retires the placeholder shame.  
3. **Hero brand scale + dark-as-brand** — makes the first viewport and the night look unmistakably StreetLens.

## Bold bet

**Make the shareable street card the product.** Not a marketing site with a map bolted on — a civic artifact: deep-linked segment, OG image that looks like a printed instrument readout, panel “Share” that municipalities forward in a thread. Landing, map, and capture all funnel into that one object. If StreetLens is “measurable streets,” the unit of virality should be a street, not a homepage.
