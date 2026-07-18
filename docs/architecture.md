# Architecture

A closer look at how StreetLens is built. For the one-diagram version, see the [README](../README.md); for the scoring model, see [method](method.md).

StreetLens is a Next.js 16 App Router application. It renders a public street-audit map for the Escazú pilot, a dedicated camera-walk collection route, an integrated community-contribution flow on the map, and a secret-gated admin queue. The data adapter is **live-first when Supabase is configured** (CV observations, approved scores, submissions) and falls back to committed static files for local development without a database.

## Routing

Everything is locale-scoped under `app/[locale]/`.

| Route | Renders |
|---|---|
| `/[locale]` | Landing. Composes `components/landing/*` sections. The hero holds the one live map; other sections use pre-rendered SVG plates. |
| `/[locale]/map` | The full-bleed audit map: `DemoBanner` + `components/AuditMap.tsx`. |
| `/[locale]/collect` | Camera-walk collection UI (`CollectClient.tsx`). Uploads frames and tracks session status. |
| `/[locale]/collect/status/[id]` | Post-upload status for one capture session. |
| `/[locale]/admin` | Dashboard (stat tiles + per-district table), `force-dynamic`. |
| `/[locale]/admin/login` | Password gate. |
| `/[locale]/admin/queue` | Submissions review. |
| `/[locale]/admin/import` | Bulk import. |
| `/[locale]/admin/history` | Submission history (all reconciled records). |
| `/[locale]/admin/capture/[id]` | Capture session review workbench. |

API routes live under `app/api/*/route.ts` (Node runtime): `admin/login`, `admin/logout`, `admin/review`, `admin/import`, `admin/capture/review`, `admin/capture/frame`, `submissions` (anonymous intake), and `routing-network` (serves the trace graph).

**Middleware** is `proxy.ts` (Next 16 renames `middleware` to `proxy`). It runs two jobs in order: an admin guard that requires a valid signed session cookie on `/(en|es)/admin/**` except `/login`, then next-intl locale prefixing with Accept-Language detection. The matcher excludes `/api`, `_next`, and static assets. Every `/api/admin/*` route **re-verifies** the session via `requireAdmin()` because the proxy does not guard API paths.

The map-embedded contribute flow (`components/contribute/*`) remains on `/map`; `/collect` is the dedicated camera-walk funnel.

## Internationalization

next-intl, configured in `i18n/`:

- `i18n/routing.ts`: `locales: ["en", "es"]`, `defaultLocale: "en"`, `localePrefix: "always"`.
- `i18n/request.ts`: `getRequestConfig` validates the locale and imports `messages/${locale}.json`.
- `i18n/navigation.ts`: locale-aware `Link`, `redirect`, `usePathname`, `useRouter`.

Messages live in `messages/en.json` and `messages/es.json` under namespaces `metadata, demoBanner, map, layers, legend, panel, detail, rubric, admin, contribute, landing`. The two files must stay at structural parity, with equal-length arrays (see [CONTRIBUTING](../CONTRIBUTING.md)). Server components use `getTranslations` / `setRequestLocale`; client components use `useTranslations`. Both locales are emitted by `generateStaticParams`.

## Data adapter (frozen contract)

`lib/segments.ts` is the single surface the UI reads segment data through. It exposes:

- `getSegments()`: the scored network as GeoJSON.
- `getSegmentDetail(id)`: one segment with its rubric breakdown.
- `getStats()`: headline figures (segment count, coverage, fail rate).

Each reader is **Supabase-first with a static fallback**: it tries `getSupabaseClient()` (the `v_segment_scores` view, CV observation RPCs, and related tables) and, when the client is unconfigured or the query errors, falls back to committed files in `data/`. With no env vars, the static path serves the app end to end. With `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, live CV and approved observations are the primary read path.

Types are the contract, in `lib/types.ts`: `ScoreLayer`, `SCORE_LAYERS`, `SegmentProperties` (flat `score_*` fields plus provenance: `source`, `verified`, `community_report`, `cv_observations`), `SegmentDetail`, `StreetStats`, and DB row mirrors. `CvAssessment` is an alias of the Zod-validated `SegmentAssessment` in `lib/assessment.ts`. `LEY_7600_MIN_SCORE = 50` is the accessibility fail threshold that drives the hero stat.

Data files in `data/`: `demo-segments.geojson` (the audited reference network), `demo-audits.json` (rubric observations tagged `rubric_version_id: "v0.1"`), `routing-network.geojson` (the trace graph), and `raw/overpass-san-antonio.json` (the OSM source). Runtime local stores (`*.local.json`) live under `data/` by default, or under `STREETLENS_DATA_DIR` when set (used by tests for isolation). Community contributions and approved CV observations persist via `lib/community-store.ts` and merge into `getSegments()` with separate provenance.

The demo data switch (`NEXT_PUBLIC_SHOW_DEMO_DATA`) gates whether the 535 generated pilot scores publish on the public map. Off by default; see `lib/demo-flag.ts`.

## Map layer

`components/AuditMap.tsx` (`"use client"`) is the single MapLibre GL engine, with variants `"hero"` and `"app"`.

- **Basemap**: OpenFreeMap **Liberty** vector tiles, with a demotiles fallback on error. After load, `muteBasemap()` recolors Liberty to the neutral grayscale palette (light and dark) and **keeps** the full label hierarchy (place, street, business, POI), tuned for legibility over score casings.
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
- **Camera-walk flow**: `app/[locale]/collect/*` handles frame upload and session status for the CV funnel (see [cv-funnel](cv-funnel.md)).
- **Intake**: `POST /api/submissions` runs a honeypot, a rate limit (`lib/rate-limit.ts`), zod validation (`lib/schemas.ts`), and then `lib/submissions-sink.ts` (a Supabase insert as `pending`, or an append to a gitignored local queue).
- **Admin apply**: `lib/apply-submissions.ts` turns an approved `add_segment` into a community segment (no scores), an `update_segment` into a community report, an approved capture session into CV observations, and a bulk import into imported segments. `lib/admin-auth.ts` is a shared-password plus HMAC session cookie via Web Crypto, with `requireAdmin()` re-checking every admin API route.

## Supabase (provisioned, env-gated)

The `supabase/` directory holds a full Postgres + PostGIS schema. Migrations `0001`–`0024` build the geography (`cantons → districts → corridors → segments`), the versioned bilingual rubric, audits and photos, the submissions queue, row-level security, admin RPCs (secret-gated `SECURITY DEFINER` functions, no service-role key), the `v_segment_scores` read model, community tables, the capture funnel (sessions, frames, extraction, synthesis, review), and CV observation contact fields. When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, the adapter and capture stack use the live database; without them, static files and local `*.local.json` stores serve development.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC), React 19, TypeScript 5 |
| i18n | next-intl (EN / ES, es-CR) |
| Map | MapLibre GL · OpenFreeMap Liberty · AWS Terrarium DEM |
| Styling | Tailwind CSS v4 · Space Grotesk, Newsreader, IBM Plex Mono |
| Geometry | Turf, `geojson-path-finder` |
| Validation | Zod |
| Backend | Supabase (Postgres + PostGIS), env-gated |
| Hosting | Vercel |

## Testing

Contract suites live in `scripts/test-*.mjs`. Run them all with `npm test` (see [CONTRIBUTING](../CONTRIBUTING.md)). Tests honor `STREETLENS_DATA_DIR` for isolated temp stores so they never clobber a developer's real `data/*.local.json` files.
