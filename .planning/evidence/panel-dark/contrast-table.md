# Measured contrast — live composited DOM, both themes

Method: for every element in `[role=dialog]` that owns a text node, walk the
ancestor chain and alpha-composite each `background-color` bottom-up to get the
EFFECTIVE background, composite the ink over it if the ink itself has alpha,
then apply the WCAG 2.1 relative-luminance formula. Measured in the running app
(`localhost:3565/en/map`, dev build), not recomputed from tokens.

The desktop numbers are stronger than that: the glass popover's real backdrop is
a live WebGL basemap that no DOM walk can see, so those were taken by sampling
RENDERED PIXELS out of the screenshot with sharp.

Fixture: `node scripts/seed-provenance-drive.mjs` (segment `esc-sa-0001`,
"Calle 130" — one canonical camera observation, one archived, one community
add). Cleaned with `--clean` afterwards; the full suite was then re-run on a
clean store.

---

## Dark, 390px — the owner's screenshot context (solid bottom sheet)

`.planning/evidence/panel-dark/panel-dark-390-scores.png`

All 33 text elements in the panel, worst first. **Minimum: 7.00:1.**

| element | ink | surface | ratio |
| --- | --- | --- | --- |
| score numeral — Shade 58 | `#92b48d` | `#212121` | **7.00** |
| score numeral — Overall 71 | `#a2b271` | `#212121` | **7.01** |
| score numeral — Accessibility 68 | `#a2acb9` | `#212121` | **7.01** |
| score numeral — Drainage 74 | `#4ebda8` | `#212121` | **7.03** |
| score numeral — Bike 45 | `#d2a27b` | `#212121` | **7.05** |
| chip — "Approved camera observation" | `#ff8ec4` | `#212121` | **7.61** |
| section label — "Camera observations" | `#b5b5b5` | `#212121` | 7.85 |
| gauge labels — Confidence / Coverage / Frames | `#b5b5b5` | `#212121` | 7.85 |
| provenance labels — Walked / Last updated / Submitted by | `#b5b5b5` | `#212121` | 7.85 |
| card label — "Current camera observation" | `#b5b5b5` | `#212121` | 7.85 |
| district — "San Antonio" | `#b5b5b5` | `#212121` | 7.85 |
| body — "An admin reviewed this camera reading…" | `#b5b5b5` | `#212121` | 7.85 |
| assessment label — "Assessment" | `#ff8ec4` | `#1a1a1a` | 8.22 |
| archive disclosure — "Archive · past observations (1)" | `#b5b5b5` | `#1a1a1a` | 8.49 |
| unaudited note — "Community-contributed…" | `#b5b5b5` | `#1a1a1a` | 8.49 |
| attribution — "Written by the camera model…" | `#b5b5b5` | `#1a1a1a` | 8.49 |
| title — "Calle 130" | `#f2f2f2` | `#212121` | 14.38 |
| lens names — Overall / Accessibility / Drainage / Shade / Bike | `#f2f2f2` | `#212121` | 14.38 |
| gauge values — 68% / 80% / 2 | `#f2f2f2` | `#212121` | 14.38 |
| dates, contributor | `#f2f2f2` | `#212121` | 14.38 |
| assessment prose — "Sidewalk has been repaved…" | `#f2f2f2` | `#1a1a1a` | 15.55 |

Mandate check: dark score inks ≥6.5 → **7.00 min, PASS**. Chips ≥6 → **7.61,
PASS**. Nothing below 4.5 → **7.00 min, PASS**.

## Dark, 1440px — desktop glass popover, sampled from rendered pixels

`.planning/evidence/panel-dark/panel-dark-1440-glass.png`

The composited panel surface, read straight out of the PNG at six points inside
the panel: `#232323` at every sampled point (`#1a1a1a` where an inner recessed
plate sits on top). That matches the predicted worst case for
`rgba(26,26,26,0.96)` over a bright basemap exactly.

| score ink | value | vs composited `#232323` |
| --- | --- | --- |
| `#a2b271` | Overall 71 | **6.84** |
| `#a2acb9` | Accessibility 68 | **6.84** |
| `#4ebda8` | Drainage 74 | **6.86** |
| `#92b48d` | Shade 58 | **6.84** |
| `#d2a27b` | Bike 45 | **6.88** |

Mandate check: ≥6.5 → **6.84 min, PASS**.

For contrast with what shipped: the previous `rgba(12,12,12,0.64)` glass over
this same light basemap composited to roughly `#5c5c5c`, against which the old
ink measured nearer 2.5:1. See the defect note in the report.

## Light, 390px — regression check

`.planning/evidence/panel-dark/panel-light-390.png`

Light is untouched by this unit (every change is scoped under `html.dark`), and
measures identically to the shipped panel. All 33 elements, **minimum 5.10:1**,
nothing below the AA floor.

| element | ink | surface | ratio |
| --- | --- | --- | --- |
| score numeral — Drainage 74 | `#2e7a6c` | `#ffffff` | 5.10 |
| score numeral — Shade 58 | `#53774e` | `#ffffff` | 5.10 |
| score numeral — Bike 45 | `#996135` | `#ffffff` | 5.10 |
| score numeral — Overall 71 | `#66733e` | `#ffffff` | 5.14 |
| assessment label | `#c0106b` | `#f1f1f1` | 5.27 |
| score numeral — Accessibility 68 | `#4f5a69` | `#ffffff` | 7.00 |
| gauge value — Frames 2 | `#111111` | `#ffffff` | 18.88 |
