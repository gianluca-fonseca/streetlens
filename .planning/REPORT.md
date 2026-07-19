# fix-map-aside-ux — bgsd-0016 REPORT

**Verdict: PASS**

Outside-tap dismissal for `SegmentDetail` works on map chrome and empty map hits while segment-to-segment switches stay flicker-free. `MapPanel` collapse is unified on desktop and mobile with visit-scoped `sessionStorage`, provenance lines and layer switcher stay visible when collapsed, and browser evidence covers both themes at desktop and 390px.

## Commits

1. `feat(map): dismiss segment detail on outside tap` — `AuditMap` capture-phase pointer listener; `SegmentDetail` `aria-modal`, Escape, `data-segment-detail`.
2. `feat(map): collapsible MapPanel aside with visit memory` — sessionStorage helper, grid collapse animation ≤280ms, provenance contract preserved.
3. `test(map): lock aside UX contracts and browser evidence` — `test-map-aside-ux.mjs`, `verify-map-aside-ux.mjs`, screenshots under `.planning/evidence/map-aside-ux/`.

## Gates (verbatim)

### tsc
```
(no output — exit 0)
```

### lint
```
> streetlens@0.1.0 lint
> eslint

/Users/filippofonseca/Developer/Projects/streetlens/.bgsd/runs/bgsd-0016-map-aside-ux/worktrees/fix-map-aside-ux/components/SegmentDetail.tsx
  14:53  warning  'cvOverallAssessment' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```
Exit 0.

### build
```
✓ Compiled successfully
✓ Generating static pages (54/54)
```
Exit 0. Full log: `.planning/evidence/map-aside-ux/gate-build.log`.

### npm test (seed clean first)
```
52/52 passed
```
Full log: `.planning/evidence/map-aside-ux/gate-test.log`.

### i18n parity
```
PASS — EN/ES message trees match
```
Full log: `.planning/evidence/map-aside-ux/gate-i18n.log`.

### Browser evidence (port 3591)
```
PASS — evidence in .planning/evidence/map-aside-ux
```
16 PNGs: outside-tap closed, panel collapsed/expanded × desktop/phone × light/dark.

## Deviations

- `useLayoutEffect` + targeted `eslint-disable` for `react-hooks/set-state-in-effect` when hydrating `sessionStorage` — lazy `useState` caused SSR/client mismatch on phone viewports and broke Playwright collapse assertions until `data-panel-hydrated` landed.
- Playwright is not a package dependency; evidence script uses `PLAYWRIGHT_MODULE` (same precedent as `verify-canonical-observation.mjs`).
- Pre-existing `cvOverallAssessment` unused import warning in `SegmentDetail.tsx` left untouched (out of scope).

## Preserved contracts

- Segment deep-links (`?segment=`), street share actions, 3D toggle, theme obedience, rev-7 ramps, keyboard Escape close, provenance visibility (`test-provenance-visibility` still passes).
