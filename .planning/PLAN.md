# u1-design-map — PLAN

Design system + map experience, per `docs/design-direction.md` (BINDING) and advisor rev 1.

## Stack reality (validated)
- Next.js 16.2.10, React 19, App Router, next-intl v4 (`[locale]` routing, en canonical + es).
- Tailwind **v4** (CSS-first `@theme` in `app/globals.css`; there is NO `tailwind.config.ts`). Theme tokens go in globals.css `@theme`. This satisfies the "tailwind config" ownership.
- MapLibre GL v5 already a dep. Basemap: OpenFreeMap Liberty with a post-load mute transform + demotiles fallback.
- Data source: `data/demo-segments.geojson` (flat props: id, name, score_overall/accessibility/drainage/shade, demo). No district/audited_at in source — adapter derives them (do NOT edit the data file).

## File map
- `app/globals.css` — rewrite: `@theme` palette (bone/pine/terracotta/warm ramp), radius 4/8/12, two warm soft-depth shadow tokens, font vars, light+dark warm base, optional paper grain.
- `app/[locale]/layout.tsx` — next/font: Bricolage Grotesque (display), Hanken Grotesk (body), IBM Plex Mono (mono); body uses Hanken; full-height flex.
- `package.json` — add `lucide-react` (icons, one stroke weight).
- `lib/segments.ts` — THIN frozen adapter (server-only, reads geojson). Exports: `ScoreLayer`, `SCORE_LAYERS`, `SegmentProperties`, `SegmentCollection`, `SegmentDetail`, `StreetStats`, `getSegments()`, `getSegmentDetail(id)`, `getStats()`. Keep minimal — u2 replaces internals, merge conflict expected.
- `messages/en.json` + `messages/es.json` — all new strings (EN canonical; es-CR: "acera").
- `components/mapConfig.ts` — per-layer color ramps (exact hexes from design), width channel, legend bins. (Within components/ boundary.)
- `components/LayerSwitcher.tsx` — the ONE neumorphic micro-control (segmented, 1px border ≥3:1 + labels + lucide icons).
- `components/Legend.tsx` — always-visible legend with explicit value bins + swatches + width cue.
- `components/MapPanel.tsx` — floating 12px primary panel: hero stat (getStats, mono) + coverage figures + switcher + legend.
- `components/SegmentDetail.tsx` — elevated panel on segment click: per-layer scores, per-item breakdown placeholder, photo placeholder grid, close.
- `components/AuditMap.tsx` — rewrite: full-bleed map, muted basemap transform, active-layer paint (color+width), fly-to on select, hover ease, dark-mode data glow layer, wires panel + detail.
- `app/[locale]/page.tsx` — kill marketing hero; full-bleed map-first; pass segments + stats from adapter.
- `components/DemoBanner.tsx` — restyle to slim honest strip in new palette (persistent, non-dismissable).

## Commit sequence (atomic, explicit pathspecs, build stays green)
1. Design tokens (globals.css, layout.tsx fonts, package.json lucide).
2. Data adapter (lib/segments.ts).
3. i18n strings (messages/en.json, messages/es.json).
4. Map building blocks (mapConfig, LayerSwitcher, Legend, MapPanel, SegmentDetail — new, unused yet).
5. Map experience wiring (AuditMap rewrite, page.tsx, layout body, DemoBanner).

## Score ramps (exact, colorblind-safe, high=good; +width channel; explicit legend bins)
- overall: clay #C0472B (0) → amber #E8B84B (50) → teal #0E7C66 (100).
- accessibility: Cividis blue sequential #00204D → #7C7B78 → #FFE945.
- drainage: Viridis blue-teal → dull yellow #21808C → #4CA377 → #C7C13B (no purple — ban list).
- shade: pale bone #DDE3CE (0) → canopy #14532D (100).
- Width: lower score = thicker (surfaces problems), monotonic → colorblind-safe redundant channel.
- Bins: 0–39 / 40–59 / 60–79 / 80–100 (Poor/Fair/Good/Excellent, bilingual).

## Ban-list guard (self-check before done)
No purple/indigo, no glassmorphism, no aurora/mesh bg, no chrome glows (glow only on data, dark only), no colored left-border cards, not Inter, no centered hero+2CTA, no emoji, no uniform rounded-xl, no default shadcn shadows. Override all tokens.

## Risks
- Liberty style mute transform is layer-name heuristic; guard every op (existence checks, try/catch), fallback to demotiles.
- getSegmentDetail is server-only (fs); client detail panel builds from feature props already shipped in the enriched collection (district/audited_at included) — no client fs.
- next-intl requires every string keyed; keep en/es in sync.
