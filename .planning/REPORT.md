# unit-continuity-inference — REPORT

**Verdict: done**

Two-tier continuity inference is live in the shared rollup baseline. Sandwich gaps (1–2 frames, even confident-absent) and long weak-absent occlusions bookended by confident-present readings become inferred-present with reduced confidence and honest provenance; edges, genuine confident-absent interruptions, and non-continuous items are untouched. Pump rollups and reviewer `recomputeReview` share one implementation and agree byte-for-byte.

## Commits

| Hash | Message |
|------|---------|
| `f704012` | feat(capture): add two-tier continuity smoothing for infrastructure |
| `073e7d1` | feat(capture): apply continuity smoothing in rollup and recompute |
| `08e7a4a` | test(capture): lock sandwich and bookend continuity fixtures |
| `c6d0dfe` | feat(admin): show inferred-from-neighbors on continuity readings |

Branch: `bgsd-0013-frontier-wave/unit-continuity-inference` (worktree-only; never pushed).

## Gates (verbatim)

```
npx tsc --noEmit
EXIT:0

npm run lint
> streetlens@0.1.0 lint
> eslint
… 1 problem (0 errors, 1 warning)  # pre-existing SegmentDetail unused import
EXIT:0

npm run build
✓ Compiled successfully
✓ Generating static pages (53/53)
EXIT:0

npm test
50/50 passed
EXIT:0

node scripts/test-i18n-parity.mjs
PARITY: OK (identical key sets)
EXIT:0
```

Evidence logs: `.planning/evidence/unit-continuity-inference/`.

## Smoothing rules (precise)

Shared pure function: `smoothContinuityReadings(key, readings)` in `lib/capture/continuity.ts`.
Called from `computeRollups` only (so `recomputeReview` → `computeRollups` is the same path).

### Scope

- Runs are **per segment**, frames ordered by `seq` ascending (then `frameId`).
- Per-item junction routing unchanged: mid-block items use mid-block frames only.
- Only keys in `CONTINUOUS_INFRASTRUCTURE_ITEMS` are smoothed; others pass through with `inferred: false`.

### Classification (A)

For a non-present reading (`boolean` value `≤0`, or graded value `<2`):

| Class | Rule |
|-------|------|
| **CONFIDENT-ABSENT** | `confidence ≥ CONTINUITY_ABSENT_CONFIDENCE` (**0.7**) |
| **WEAK-ABSENT** | `confidence < 0.7` |

**Confident-present** (anchor / bookend): present **and** `confidence ≥ CONTINUITY_NEIGHBOR_CONFIDENCE` (**0.6**).

### Tier 1 — SANDWICH (B)

A consecutive run of **1 or 2** non-present readings (`CONTINUITY_MAX_GAP = 2`) whose **immediate** left and right neighbors are both confident-present → each dissenting frame is reclassified:

- `value` → boolean `1`, or graded `min(left.value, right.value)`
- `confidence` → `round3(min(left.confidence, right.confidence) × 0.5)`
- `inferred` → `true`

Applies even when the dissent is confident-absent (model can be flat wrong on a single oblique frame).

### Tier 2 — BOOKEND BRIDGE (C)

After Tier 1, for each consecutive pair of confident-present anchors at **any** distance within the segment run:

- If **any** intervening reading is CONFIDENT-ABSENT → bridge **broken**; no Tier-2 flips for that pair.
- Else every intervening WEAK-ABSENT → inferred-present (same value/confidence rule as Tier 1, using the bookend anchors).

### Non-flips (D)

- Leading / trailing absents with no bookend on one side → never flip.
- Confident-absent runs of length ≥3 between presents → Tier 1 skips (gap > 2); Tier 2 broken → never flip.
- Bridges never cross segment boundaries (segment bucketing in `computeRollups`).

### Honesty / provenance

On `item_medians[key]` when any contributing reading was inferred:

```json
{ "inferred": true, "inferredFrames": <n> }
```

Review UI (`FrameInspector`) shows **“Inferred from neighbors”** / **“Inferido de vecinos”** on those item rows via `inferredKeysForFrame` (same pure rules).

## Item set chosen + rationale

| Included | Why |
|----------|-----|
| `sidewalk_present` | Continuous built presence — owner directive core |
| `sidewalk_width` | Attribute of the same continuous object |
| `surface_condition` | Same continuous walking surface |
| `bike_lane_present` | Continuous lane presence (same physics) |
| `bike_separation` | Kin attribute of continuous bike infrastructure |
| `bike_surface` | Kin attribute of continuous bike infrastructure |

| Excluded | Why |
|----------|-----|
| `standing_water` | Ponding is transient, not continuous infrastructure |
| `obstruction_free` | Point/transient obstacles; can legitimately blink |
| `drain_present` | Point feature |
| `curb_ramp`, `crossing_safety` | Junction-local |
| `canopy_cover`, `midday_shade`, `lighting` | Variable canopy / lighting, not a continuous slab |
| `curb_gutter` | Drainage geometry; not “presence of sidewalk” kin |

## Fixture table

| Fixture | Expectation | Result |
|---------|-------------|--------|
| Sandwich of 1 (confident-absent middle) | Flip → inferred-present @ 0.45 | PASS |
| Sandwich of 2 | Both flip | PASS |
| Edge leading / trailing absent | No flip | PASS |
| ≥3 confident-absent between presents | No flip | PASS |
| Long weak-absent stretch with bookends (5 frames) | All flip | PASS |
| Long stretch with one confident-absent inside | Bridge broken, no flip | PASS |
| Bookend one side only (leading or trailing) | No flip | PASS |
| Low-confidence neighbor (<0.6) | No sandwich anchor | PASS |
| `standing_water` sandwich | Never smoothed | PASS |
| Graded `sidewalk_width` sandwich | Flip to min neighbor | PASS |
| Rollup sandwich → median present + `inferred` | PASS | PASS |
| Rollup Tier-2 bookend → median present | PASS | PASS |
| `recomputeReview` ≡ `computeRollups` | Byte-identical | PASS |

Suite: `scripts/test-continuity-smoothing.mjs` (also under `npm test`).

## Assumptions

1. **Absent confidence threshold 0.7** separates occlusion/out-of-view (weak) from a model assertion that infrastructure is missing (confident). Neighbor/bookend anchors stay at **0.6** so a slightly softer present still anchors short sandwiches.
2. **Present** for graded items means value **≥ 2** (same bar as “usable presence” for continuity; 0–1 is treated as strongly lower / absent).
3. **Inferred confidence factor 0.5** keeps inferred readings from dominating the confidence-weighted median while still participating.
4. **`seq` is required** on `RollupObservation`; pump maps `r.seq`, recompute maps `f.seq`. No migration — rollups recompute at pump/review time; `item_medians` JSON already accepts extra keys.
5. UI marker uses mid-block usable segment mates with override-applied values so the inspector matches what recompute would infer.

## Deviations

- None material vs the owner extension. The original brief’s “gap of up to 2” is preserved as Tier 1; Tier 2 bookend bridge is additive per the pre-build owner extension.
- No schema migration (0035 not needed).
- Synthesis prompts untouched; score formulas untouched beyond smoothed item inputs; `getStats` / sealed honesty rules untouched.

## Touched surfaces

- `lib/capture/continuity.ts` (new)
- `lib/capture/rollup.ts`, `pump.ts`, `review-overrides.ts`, `review-store.ts`
- `components/admin/FrameInspector.tsx`, `CaptureReview.tsx`
- `messages/en.json`, `messages/es.json`
- `scripts/test-continuity-smoothing.mjs` (+ compile-list updates in related test scripts)
