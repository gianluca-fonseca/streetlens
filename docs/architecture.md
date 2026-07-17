# Architecture

A closer look at how StreetLens is built. For the one-diagram version, see the [README](../README.md); for the scoring model, see [method](method.md).

StreetLens is a Next.js 16 App Router application. It renders a public street-audit map for the Escazú pilot, an integrated community-contribution flow, and a secret-gated admin queue. It runs entirely off committed static data today; Supabase is fully schema'd but env-gated off.

## Routing

Everything is locale-scoped under `app/[locale]/`.

| Route | Renders |
|---|---|
| `/[locale]` | Landing. Composes `components/landing/*` sections. The hero holds the one live map; other sections use pre-rendered SVG plates. |
| `/[locale]/map` | The full-bleed audit map: `DemoBanner` + `components/AuditMap.tsx`. |
| `/[locale]/admin` | Dashboard (stat tiles + per-district table), `force-dynamic`. |
| `/[locale]/admin/login` | Password gate. |
| `/[locale]/admin/queue` | Submissions review. |
| `/[locale]/admin/import` | Bulk import. |

API routes live under `app/api/*/route.ts` (Node runtime): `admin/login`, `admin/logout`, `admin/review`, `admin/import`, `submissions` (anonymous intake), and `routing-network` (serves the trace graph).

**Middleware** is `proxy.ts` (Next 16 renames `middleware` to `proxy`). It runs two jobs in order: an admin guard that requires a valid signed session cookie on `/(en|es)/admin/**` except `/login`, then next-intl locale prefixing with Accept-Language detection. The matcher excludes `/api`, `_next`, and static assets.

There is no standalone `/collect` route. The "collect" flow is embedded inside the map (`components/contribute/*`).

## Internationalization

next-intl, configured in `i18n/`:

- `i18n/routing.ts`: `locales: ["en", "es"]`, `defaultLocale: "en"`, `localePrefix: "always"`.
- `i18n/request.ts`: `getRequestConfig` validates the locale and imports `messages/${locale}.json`.
- `i18n/navigation.ts`: locale-aware `Link`, `redirect`, `usePathname`, `useRouter`.

Messages live in `messages/en.json` and `messages/es.json` under namespaces `metadata, demoBanner, map, layers, legend, panel, detail, rubric, admin, contribute, landing`. The two files must stay at structural parity, with equal-length arrays (see [CONTRIBUTING](../CONTRIBUTING.md)). Server components use `getTranslations` / `setRequestLocale`; client components use `useTranslations`. Both locales are emitted by `generateStaticParams`.

## Data adapter (frozen contract)

`lib/segments.ts` is the single surface the UI reads segment data through. It exposes:

- `getSegments()` — the scored network as GeoJSON.
- `getSegmentDetail(id)` — one segment with its rubric breakdown.
- `getStats()` — headline figures (segment count, coverage, fail rate).

Each reader is **Supabase-first with a static fallback**: it tries `getSupabaseClient()` (the `v_segment_scores` view and RPCs) and, on a null client or an error, falls back to the committed files in `data/`. Because the database is env-gated off, the static path serves everything today. This is the seam that lets the whole app run with no backend.

Types are the contract, in `lib/types.ts`: `ScoreLayer`, `SCORE_LAYERS`, `SegmentProperties` (flat `score_*` fields plus provenance: `source`, `verified`, `community_report`), `SegmentDetail`, `StreetStats`, and DB row mirrors. `LEY_7600_MIN_SCORE = 50` is the accessibility fail threshold that drives the hero stat.

Data files in `data/`: `demo-segments.geojson` (the audited reference network, read by both the adapter and the render script), `demo-audits.json` (rubric observations tagged `rubric_version_id: "v0.1"`), `routing-network.geojson` (the trace graph), and `raw/overpass-san-antonio.json` (the OSM source). Community contributions persist to a gitignored `data/community-segments.local.json` via `lib/community-store.ts` and merge into `getSegments()` with no scores.

## Map layer

`components/AuditMap.tsx` (`"use client"`) is the single MapLibre GL engine, with variants `"hero"` and `"app"`.

- **Basemap**: OpenFreeMap **Liberty** vector tiles, with a demotiles fallback on error. After load, `muteBasemap()` recolors Liberty to the neutral grayscale palette (light and dark) and hides POI labels.
- **Score layers**: one GeoJSON source (`segments`, `promoteId: "id"`) drives `segments-glow` (dark only), `segments-line` (the score ramp), and `segments-community` (the neutral dashed casing). Hover and selection use feature-state.
- **3D**: an optional DEM terrain from **AWS Terrarium** tiles (`encoding: "terrarium"`), an always-on hillshade, and OSM building extrusions, with a camera clamp that works around the sea-level sink bug.

Supporting UI: `MapPanel` (stats + `LayerSwitcher` + `Legend`), `SegmentDetail`, and `DemoBanner`.

### `mapConfig.ts`: sealed vs reskinnable

`components/mapConfig.ts` is the map's single source of truth, and it has two zones:

- **Sealed (do not change without a design ruling):** `RAMP` (per-lens color stops), `BINS` (value bins), the width channel (`WIDTH_AT_0 = 6`, `WIDTH_AT_100 = 2.5`), and `COMMUNITY_CASING`. These encode data meaning. On the grayscale basemap they are deliberately the loudest color on screen.
- **Reskinnable basemap chrome:** `BASEMAP`, `HILLSHADE_PAINT`, and `BUILDINGS.color` set the neutral grayscale-zen tint of land, roads, water, and buildings. These can be retuned for a theme pass, as long as the sealed score layers stay untouched.

Expression builders (`lineColorExpression`, `lineWidthExpression`, `sampleRamp`, `widthForValue`) turn the config into MapLibre paint.

## Render pipeline

`scripts/render-map-images.mjs` (`npm run render:maps`) is a zero-dependency Node script that reads `data/demo-segments.geojson`, projects the LineStrings, and paints them with **verbatim-mirrored** copies of `RAMP`, the width channel, and `BASEMAP` from `mapConfig.ts`. It writes the static SVG plates in `public/render/` (per-lens, wide overall, dark, and per-district) that the landing sections use as background art under glass panels.

The mirror is the one place the "single source of truth" is intentionally duplicated: the `.ts` config cannot be imported into the plain-ESM script, so after any sealed-config change you must re-run `npm run render:maps` to keep the static plates in sync with the live map.

## Contribution and submissions

- **Map-integrated flow**: `components/contribute/*` holds a small state machine (`useContribute.ts`) and a street-following trace built on `geojson-path-finder` over `/api/routing-network`.
- **Intake**: `POST /api/submissions` runs a honeypot, a rate limit (`lib/rate-limit.ts`), zod validation (`lib/schemas.ts`), and then `lib/submissions-sink.ts` (a Supabase insert as `pending`, or an append to a gitignored local queue).
- **Admin apply**: `lib/apply-submissions.ts` turns an approved `add_segment` into a community segment (no scores), an `update_segment` into a community report, and a bulk import into imported segments. `lib/admin-auth.ts` is a shared-password plus HMAC session cookie via Web Crypto, with no user table.

## Supabase (planned)

The `supabase/` directory holds a full Postgres + PostGIS schema that is not yet provisioned. Migrations `0001`–`0012` build the geography (`cantons → districts → corridors → segments`), the versioned bilingual rubric (`rubric_versions`, `rubric_items`, `observations`), audits and photos, the submissions queue, row-level security, admin RPCs (secret-gated `SECURITY DEFINER` functions, no service-role key), the `v_segment_scores` read model, and the community tables. Until the env vars are set, the adapter's static fallback serves the app.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC), React 19, TypeScript 5 |
| i18n | next-intl (EN / ES, es-CR) |
| Map | MapLibre GL · OpenFreeMap Liberty · AWS Terrarium DEM |
| Styling | Tailwind CSS v4 · Space Grotesk, Newsreader, IBM Plex Mono |
| Geometry | Turf, `geojson-path-finder` |
| Validation | Zod |
| Backend (planned) | Supabase (Postgres + PostGIS, Auth, Storage) |
| Hosting | Vercel |
