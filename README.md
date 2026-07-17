# StreetLens

**Auditoría abierta de calles — Open street audit platform for Costa Rica.**

StreetLens is an open-source, bilingual (ES/EN) platform for auditing the quality, accessibility, drainage, and shade of city streets, one segment at a time. The pilot audits the cantón of **Escazú, Costa Rica** against a rubric adapted from validated instruments (MAPS-Mini, LANAMME-UCR's sidewalk condition index, Ley 7600 accessibility requirements, and the HOT/Resilience Academy drainage-mapping protocol).

A project of **CUSP** (Collective for Urbanism and Sustainable Progress), led by [Gianluca Fonseca](https://github.com/gianluca-fonseca).

> **Status: pre-pilot development.** The public map currently shows clearly-labeled DEMO data over real street geometry. Field data collection begins August 2026. No number shown on a demo surface is a real measurement.

## The product, in one sentence each

- **Public map (`/`):** every audited street segment drawn and colored by score, with layer toggles (overall, Ley 7600 accessibility, drainage, shade), per-segment detail panels with photos and score breakdowns, and one headline stat at the top that anyone can understand.
- **Collect (`/collect`):** a mobile-first PWA where an audit session works like a tracked workout: pick segments, walk them, answer the rubric step by step, photos geotag automatically, segments light up as they're completed, offline-tolerant, with session summaries and district coverage stats.
- **Admin (`/admin`):** corridor/segment management (OSM geometry import), audit QA and re-audit flagging, photo moderation, versioned rubric editor, COSEVI crash-data import, open-data exports.

## Why

- No Costa Rican municipality publishes sidewalk-condition, accessibility, or drainage inventories. This data does not exist.
- 1,601 pedestrian run-overs in 2024 (COSEVI); pedestrians are the largest road-death victim category.
- Ley 7600 (accessibility) turned 30 in 2026; Ley 9976 (2021) obligates municipal pedestrian-mobility action. The legal frame exists. The data is missing.
- StreetLens produces the missing dataset: open, methodology-versioned, reproducible, and delivered to the municipality as a ranked action list.

## Data model (the long game)

`cantons → districts → corridors → segments` (stable IDs, PostGIS LineStrings) → `audits` (segment × date × auditor) → `observations` (responses to `rubric_items` under versioned `rubric_versions`) → `photos` linked to specific rubric items.

Design consequences, intentional:

- **Cross-canton comparison is native.** Escazú is the pilot, not the boundary.
- **Every photo is a labeled training example** (item + response + image), accumulating a CV training corpus as a byproduct of fieldwork (Project Sidewalk precedent: human audit first, ML assist later).
- **Re-audits are first-class**, so temporal change ("did it get fixed?") is queryable.
- **COSEVI crash events spatially join to segments**, so audit scores can be tested against real incident data.
- **Rubric is data, not code.** Methodology versions are permanent and old audits stay interpretable.
- **Open by default:** GeoJSON/CSV endpoints, sidewalk geometry contributed back to OpenStreetMap (OpenSidewalks schema).

## Stack

Next.js 15 + TypeScript · Tailwind + shadcn/ui · MapLibre GL (open tiles) · Supabase (Postgres + PostGIS, Auth, Storage) · Vercel.

## The CV data-collection funnel

Alongside the manual audit flow, a contributor can film a street (live on the phone or by uploading a video) and have a vision model score the frames against the same rubric v0.1 a human auditor uses. Frames are placed on the street network by map matching, scored one call per frame, and rolled up into per-segment lens scores. The result is a **proposal, not data**: it enters the same review queue a manual contribution does, and nothing reaches the published map without a human approving it. See [`docs/cv-funnel.md`](docs/cv-funnel.md) for the full architecture, cost model, edge-case catalog, and ops runbook.

## Roadmap

- **Phase A (July 2026):** public map over real OSM geometry for the San Antonio pilot corridor, synthetic demo data, persistent demo banner.
- **Phase B (→ early Aug):** collect flow + admin; rubric v0.1 frozen after a 5-segment field test.
- **Phase C (Aug–mid Sept):** real fieldwork replaces demo data corridor by corridor; QA + 10% re-audits.
- **Phase D (Sept–Oct):** stats and comparison pages (San Antonio vs San Rafael), crash overlay, bilingual PDF report, open-data endpoints. v1.0.
- **Phase 2 (2027):** CV-assisted labeling from the photo corpus, additional cantons, school replication accounts.

## Honesty rules (non-negotiable)

Demo data is always labeled. Scores are published with the formula. Limitations are documented. Nothing is described as active, national, or adopted unless it is. See `docs/methodology` (from v0.1 onward) for the versioned rubric and scoring.
