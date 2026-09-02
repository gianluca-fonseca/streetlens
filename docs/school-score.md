# Escuela Segura — the standard

**A rating for the streets around a school, not for the school.**

StreetLens does not grade education. It measures whether the walk to class is
safe, legal, and passable, and publishes that measurement against a standard
anyone can check and argue with.

This document is the standard. It is written to be read by a sustainability
director or a school board, not only by an engineer, and everything in it is
reproducible from the data in this repository.

---

## 1. Why school zones

**The children with the least choice walk the most.** A household with a car
can drive around a missing sidewalk. A household without one cannot, and its
children walk or cycle the same broken block twice a day, every school day.
Concentrating on the streets around public schools reaches precisely the
families with no way around the problem.

**The fix is usually small and specific.** Very little of what makes a school
walk dangerous is a corridor rebuild. It is a crossing that was never painted, a
ramp that stops at a kerb, a drain that floods the only sidewalk. Naming those,
school by school, converts an overwhelming problem into a fundable list.

**One canton is a template, not an endpoint.** Costa Rica has more than four
thousand centros educativos. The point of doing Escazú properly is not Escazú:
it is to leave behind a published standard, a method, and a working instrument
that the next canton can adopt without inventing any of it. Get one right and
the rest is repetition.

---

## 2. What is measured, and by what

**Nothing new is measured.** This is the single most important design decision
in the standard.

A school's rating is an **aggregation of street scores that already exist**. The
capture pipeline is unchanged: someone records a walk or a drive, the video is
split into keyframes, each keyframe is scored by the vision model, and a field
audit can override the result. Those per-segment scores are what the public map
has always drawn.

A second, school-specific measurement was rejected for two reasons. It would
need its own rubric and its own defence, doubling the surface a partner has to
trust. And it would allow a school's rating to disagree with the streets drawn
underneath it on the same map, which is the one inconsistency a reader would
never forgive.

One pipeline, two readings.

---

## 3. The zone

Two rings, both measured as **walking distance along the street network**, not
as a straight line from the gate:

| Ring | Radius | What it is |
| --- | --- | --- |
| **Portón** (gate) | 150 m | The approach: the crossing outside the gate, the drop-off, the first block. Where school-zone speed rules apply and where an intervention is cheapest. |
| **Trayecto** (walk) | 400 m | The walking catchment, about five minutes at a child's pace. The streets children actually arrive on. |

Gate-ring streets count **double** in every calculation. Thirty metres outside
the door is not the same street as one three hundred metres away, and a flat
mean says it is.

### Why not a radius

A 400 m circle drawn over Escazú includes streets on the far side of the
Próspero Fernández that no child has ever walked to school on. Scoring them
would be measuring the wrong thing, which is the failure mode that discredits an
instrument faster than any amount of noise.

The difference is not academic. Measured across all 33 schools:

| Method | Mean segments per zone |
| --- | --: |
| 400 m straight-line circle | 43.5 |
| 400 m network walkshed | **18.6** |

A plain radius was over-counting by more than half.

The map still **draws** a circle, because a circle is legible at a glance and an
irregular walkshed is not. Streets inside the drawn circle that the walkshed
cannot reach are drawn dim and excluded from the score, so the gap between the
marker and the measurement is visible rather than hidden.

### How the walkshed is computed

Dijkstra over `data/routing-network.geojson` (12,565 walkable nodes, 99.2% one
connected component), bounded at the outer radius. Motorway-class ways are
excluded: motorway frontage is not a walk to school.

Mapping the result back onto scored segments is **exact, not approximate**.
Every one of the 1,457 segments in `data/segments.geojson` shares at least one
vertex, to six decimal places, with the routing graph — both were carved from
the same OSM ways. A segment's walking distance is the smallest settled distance
among its own vertices. No snapping tolerance, nothing to tune.

A segment counts as reachable at the distance of its **nearest** vertex. The
question is "can a child reach any part of this street within R", not "is the
whole street inside R".

---

## 4. The two numbers

A school carries a **tier** and a **score**, and they answer different questions.

### Tier — from Ley 7600 compliance

> What share of the weighted walk to this school meets the legal accessibility
> minimum?

This drives the seal. It is anchored to law rather than to a curve we invented,
so it is arguable in front of a ministry or a municipality. The threshold is the
same one the rest of the platform already uses: **accessibility ≥ 50/100** per
segment.

### Score — the 0–100 diagnostic

A weighted composite of four lenses, re-weighted for a walking child:

| Lens | Weight | Why |
| --- | --: | --- |
| Accessibility | 45% | Sidewalk continuity, ramps, crossings. The thing that kills, and the lens Ley 7600 legislates. |
| Drainage | 20% | A sidewalk that floods in the rainy season puts a child in the traffic lane. In this canton that is a seasonal certainty, not an edge case. |
| Shade | 20% | Tropical midday sun on the walk home, and a proxy for a street with a planted buffer between child and traffic. |
| Bike | 15% | Secondary students arrive on bikes, and separated infrastructure means a buffer even for those on foot. |
| *Crash density* | **0%** | Declared and dated. See §7. |

The composite deliberately does **not** reuse the existing `overall` lens. That
lens answers "is this a good street", which is a different question from "is
this a safe walk for a seven-year-old".

Segment weight is `length × ring weight`. Compliance is therefore weighted by
**metres walked**, not by a count of segments: one long compliant street and
three short failing ones is not 25% compliant.

---

## 5. The two rules that protect the seal

These matter more than the weights.

### Coverage gate

A zone where most of the walk has never been assessed **cannot be rated at
all**. It publishes as `sin datos suficientes` — no tier, no number.

| Threshold | Requirement |
| --- | --- |
| < 60% of zone length assessed | No rating published |
| ≥ 80% | Required for the seal |

On today's data that holds back **19 of 33 schools**, and saying so plainly is
the point. A green rating computed from three observed segments is precisely the
methodology failure that ends a partnership conversation.

An unassessed segment contributes **nothing** to the score and instead counts
against coverage. Treating its stored zeros as data would drag every rating down
in proportion to how little has been surveyed, turning ignorance into a finding
and making a well-surveyed school look worse than an unsurveyed neighbour.

### Gate veto

One segment inside the 150 m ring scoring below **25** caps the whole school at
`crítico`, whatever the average says.

A mean is very good at hiding one bad block, and a certification that can be
earned by averaging away a lethal gap outside the front gate is worth nothing.

---

## 6. The ladder

| Tier | Requires |
| --- | --- |
| **Sin datos suficientes** | Coverage below 60% |
| **Crítico** | Compliance < 40%, **or** a gate veto |
| **En riesgo** | Compliance 40–64% |
| **En progreso** | Compliance 65–84% |
| **Escuela Segura** | Compliance ≥ 85%, coverage ≥ 80%, no gate veto, **and at least one human field audit** — not a camera pass alone. Valid 24 months. |

**Calibration note.** These cuts come from the standard's intent (85% ≈
"essentially the whole walk is legal"), not from fitting a distribution. They
have not been calibrated against real field data because there is not yet enough
of it, and calibrating against the demo era would produce a number that looks
rigorous and means nothing. They live in one named constant block in
`lib/school-score.ts` so recalibration is one edit and a changelog line.

**Governance.** StreetLens defines and operates the *measurement*. The *seal*
should be awarded by a convening body — a funder together with the MEP or a
municipality. This mirrors Bandera Azul, which works precisely because the body
awarding the flag is not the body selling the measurement. A self-awarded
certification is the weakest form and invites exactly the credibility critique
this standard exists to survive.

---

## 7. What is not in the rating yet

**Crash and incident history.** Camera data alone establishes what a street *is*;
it does not establish where people are actually being hurt. The right input is a
collision feed — Waze CCP, COSEVI, or municipal records — and until one lands, no
school's rating reflects it.

The term is carried in the formula at **weight zero, with a note and a date**,
rather than omitted. A missing component that is declared is a known limitation;
one that is silently absent is a misrepresentation.

**Enrolment (matrícula).** The MEP register carries no enrolment figures, so
intervention priority currently uses a proxy: public schools serve the children
least able to choose a safer route or be driven, and the youngest walk least
predictably. Admins can enter real enrolment per school, which upgrades the
ranking off the proxy immediately.

**Time of day.** Every reading is a single pass. Peak-hour conditions outside a
gate at 06:50 are not the same as at 14:00, and the standard does not yet model
that.

---

## 8. Intervention priority

Deliberately **not** the same as the safety rating. The worst school is not
automatically the best place to spend, and the question a funder asks is where
money goes furthest.

```
priority  =  deficit  ×  exposure  ×  (0.6 + 0.4 × tractability)  ×  veto bonus

deficit       100 − score. How far below the standard the walk is.
exposure      enrolment when known, otherwise a sector and level proxy.
tractability  share of the recoverable points sitting in the 150 m gate ring,
              where a crossing or a ramp is a weekend of work rather than a
              corridor rebuild.
veto bonus    ×1.25 when a gate segment has tripped the veto.
```

Tractability lifts rather than gates: a school whose problems are all
corridor-shaped still needs fixing, it is just a bigger cheque.

**An unrated school gets no priority number at all**, rather than a zero.
Ranking a school last because nobody has surveyed it would invert the actual
priority, which is to go and survey it.

---

## 9. Reproducing every number

Nothing here is a stored snapshot. Ratings recompute from live segment readings
on every page load, so a rating moves the moment a capture is reviewed or a
field audit lands.

```bash
node scripts/build-schools.mjs        # roster from the MEP SIGMEP register
node scripts/build-school-zones.mjs   # walkshed membership (geometry only)
node scripts/test-school-score.mjs    # the standard's properties, as tests
```

| Artefact | What it holds |
| --- | --- |
| `data/schools.geojson` | The roster, with per-site provenance and every exclusion argued |
| `data/school-zones.json` | Walkshed membership. **No scores** — geometry only |
| `lib/school-score.ts` | The standard as arithmetic. Pure, no I/O, no clock |
| `lib/school-report.ts` | The join: roster + zone + live readings + human edits |

The admin surface at `/admin/schools` shows, for every school, each segment in
its zone with its ring, walking distance, weight share, contributed points, and
the evidence behind its reading. A score you cannot take apart is a score nobody
will defend in a meeting.

**Overrides.** An admin can publish a tier or score that differs from the
arithmetic, with a required written reason. The computed value is kept beside it
and every public surface labels the figure as overridden. The disagreement is
always visible, never silently resolved.

---

## 10. Sources

- **Roster** — MEP SIGMEP feature services (`MEP_CEPUBCR_1` público,
  `MEP_CEPRIVCR_1` privado). Attribution: Sistema de Información Geográfica del
  Ministerio de Educación Pública.
- **Street network and positions** — OpenStreetMap contributors, ODbL.
- **Legal threshold** — Ley 7600, Igualdad de Oportunidades para las Personas
  con Discapacidad.
- **Street scores** — StreetLens capture pipeline. See `docs/` and the public
  method page.
