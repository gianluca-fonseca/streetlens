# Method

How StreetLens turns a walked street into a score you can read, compare, and check. This document covers the four lenses, rubric v0.1, the scoring scale and bins, the sealed color and width encoding, and exactly what is demo today.

See also: the [README](../README.md) for the short version, and [architecture](architecture.md) for where each piece lives in the code.

## Lineage

The rubric derives from validated instruments, not invented ones:

- **MAPS-Mini**, the Microscale Audit of Pedestrian Streetscapes: a validated microscale audit of sidewalks, crossings, and buffers.
- **LANAMME-UCR**, the national road-materials laboratory at the University of Costa Rica, for pavement and condition standards.
- **Ley 7600**, Costa Rica's Equal Opportunities for Persons with Disabilities Act, and its Reglamento (Decreto Ejecutivo N° 26831-MP), for the accessibility minimums.
- Open drainage-mapping practice for the flood-risk items.

Segment geometry comes from **OpenStreetMap** (ODbL), and audited sidewalk geometry is contributed back under the OpenSidewalks schema.

## The four lenses

Every segment is scored on four independent lenses plus one composite. Each is 0 to 100, higher is better. The lenses are independent rubrics scored the same way in any city, so cross-canton comparison is native.

| Lens | Reads | What it answers |
|---|---|---|
| **Accessibility** | Curb ramps, tactile paving, safe crossings, effective width | Can everyone actually use this sidewalk? (Ley 7600) |
| **Drainage** | Grates and inlets, cross slope, ponding history | Does it flood, or drain? |
| **Shade** | Tree canopy, cover, sun exposure | Exposed pavement, or full canopy? |
| **Bike** | Lanes, separation from traffic, connectivity | Can you ride it, and is it protected? |
| **Overall** | The composite sidewalk score | One number anyone can act on. |

Shade and drainage are the climate-resilience lenses: shade tracks heat exposure, drainage tracks flood risk.

## Rubric v0.1

The rubric is **data, not code**. Versions are permanent, so an audit taken under v0.1 stays interpretable forever. v0.1 defines 15 observed items across the lenses, each with a fixed response type.

| Item | Lens | Response |
|---|---|---|
| Sidewalk present | accessibility | boolean |
| Sidewalk width ≥ 1.2 m | accessibility | scale 0–4 |
| Sidewalk surface condition | accessibility | scale 0–4 |
| Curb ramp at crossing | accessibility | boolean |
| Path free of obstructions | accessibility | scale 0–4 |
| Storm drain / grate present | drainage | boolean |
| No standing-water evidence | drainage | scale 0–4 |
| Curb and gutter condition | drainage | scale 0–4 |
| Tree canopy coverage | shade | percent |
| Shade at midday | shade | scale 0–4 |
| Street lighting | overall | scale 0–4 |
| Crossing safety | overall | scale 0–4 |
| Dedicated bike lane or path | bike | boolean |
| Separation from motor traffic | bike | scale 0–4 |
| Cycling surface quality | bike | scale 0–4 |

Each response maps to a 0-to-100 contribution, and a lens score aggregates its items. The aggregation formula is frozen together with the rubric version before the field test, and **every published score carries its version and its formula**. StreetLens is not a black box: a score you cannot explain does not ship.

### Accessibility and the law

The accessibility lens is anchored to enforceable minimums, drawn on [Plate 1](../public/drawings/plate-1-cross-section.svg). Under the Reglamento a la Ley 7600 (Decreto Ejecutivo N° 26831-MP):

- **Art. 125.** Sidewalks must be at least **1.20 m** wide, with a non-slip finish, no steps, and a cross slope of at most **3%**; the curb rises **0.15 to 0.25 m** from the gutter cord.
- **Art. 126.** Every corner needs a curb ramp with a gradient of at most **10%** and a width of at least **1.20 m**.
- **Art. 127.** Signs and projecting objects must clear at least **2.20 m**.

An accessibility score below **50** is treated as failing the legal minimum, which drives the headline "share of audited segments that fail Ley 7600."

## Scoring scale and bins

Scores are continuous 0 to 100 and grouped into four legend bins. The legend is never color-only: every bin shows its numeric range.

| Bin | Range |
|---|---|
| Excellent | 80–100 |
| Good | 60–79 |
| Fair | 40–59 |
| Poor | 0–39 |

This encoding is illustrated on [Plate 2](../public/drawings/plate-2-scoring-anatomy.svg).

## Color and width encoding (sealed)

Each lens has its own colorblind-safe ramp, and every ramp is paired with a redundant **line-width channel** so a low score reads even in grayscale. The ramps, bins, and widths live in `components/mapConfig.ts` and are mirrored into `scripts/render-map-images.mjs`; both are sealed.

| Lens | Ramp | Stop 0 (worst) | Stop 50 | Stop 100 (best) |
|---|---|---|---|---|
| Overall | traffic light: coral-red → burnt orange → emerald | `#F45E53` | `#CE4D02` | `#056E48` |
| Accessibility | violet: orchid → electric indigo | `#CE63E9` | `#A844EA` | `#7629F1` |
| Drainage | cyan → deep azure | `#0E9EAF` | `#077FA8` | `#0263A8` |
| Shade | lime → deep canopy | `#729D0D` | `#148918` | `#07703F` |
| Bike | pink → deep magenta | `#EF599A` | `#DF1194` | `#B20795` |

These are rev 7. Every stop is solved to a target relative luminance (0.278 at
score 0, 0.183 at 50, 0.118 at 100) rather than picked by eye, because the
basemap is near-white in light and near-black in dark: only a middle luminance
band clears both. Two properties fall out of that construction. Every stop holds
at least 3:1 against the light basemap and ~2.9:1 against the dark one, and
luminance descends monotonically along every ramp, so bad → good still reads
with all colour removed (a ~1.95:1 grayscale spread) and does not depend on
telling red from green. `scripts/test-ramp-legibility.mjs` asserts those rules
directly, so a future retune has to preserve them rather than just re-freeze new
values.

Width channel: a segment's line is **6.0 px** at score 0 and narrows to **2.5 px** at score 100, so the lowest-scoring segments are the thickest and most visible.

**Community casing.** Resident-contributed and imported segments never borrow a score color. They draw in a fixed neutral grey (`#6B7069`), dashed, until a field audit verifies them. Unverified geometry must not look like a measurement.

## What is demo today

StreetLens is in pre-pilot development. Everything on the public map right now is **demo data generated over real OpenStreetMap geometry**, so the map behaves exactly as it will with field data.

- No number on a demo surface is a real measurement. Demo scores are synthesized over real geometry (for example, drainage degrades near streams and accessibility degrades on steeper streets), not computed from field observations.
- Real measurements replace demo data **corridor by corridor** once fieldwork begins in **August 2026**, starting with San Antonio de Escazú.
- Re-audits are first-class, so change over time ("did it get fixed?") is queryable once real data lands.
- COSEVI crash events join spatially to segments, so audit scores can eventually be tested against real incident data.

Every audit also produces geotagged, labeled photos. Those accumulate into a corpus that is meant to train a computer-vision and machine-learning pipeline over time, described on [Plate 3](../public/drawings/plate-3-method-pipeline.svg). No model scores a street today; when one does, a person still verifies what it reports.
