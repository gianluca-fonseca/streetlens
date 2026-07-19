# unit-ci-green — REPORT

## Verdict

**PASS** — CI is genuinely green. Verified on PR #35; green run linked below.

## Root cause

Every CI run on `main`/`next` since the workflow shipped died in ~20s at **`npm ci`**, before any gate ran:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
npm error Missing: @swc/helpers@0.5.23 from lock file
```

The lockfile had been regenerated with **npm 11 (Node 24)** locally, which tolerates the drift. **GitHub Actions used Node 20 / npm 10**, which rejects it. This was the sole blocker on historical runs (run `29667375625`).

After fixing the lockfile, a second class of failures appeared only under Node 20:

| Suite | Failure on Node 20 |
|-------|-------------------|
| `test-canonical-observation.mjs` | `ERR_UNKNOWN_FILE_EXTENSION` importing `.ts` directly |
| `test-map-cv-visibility.mjs` | same |
| `test-pipeline-truth.mjs` | Supabase client requires `ws` polyfill (no native WebSocket) |

These pass on **Node 22+** (native TypeScript stripping + WebSocket), matching local dev. Build did **not** need real Supabase secrets — only placeholder `NEXT_PUBLIC_*` for honest inlining.

**Not the cause:** missing repo secrets, Docker unavailability (migration suite passed on ubuntu-latest once install succeeded).

## Commits

| Hash | Message |
|------|---------|
| `cfdf4ac` | fix(deps): sync package-lock.json for Node 20 npm ci |
| `422030b` | ci: add safe public placeholder env for build and tests |
| `c01fcb6` | ci: use Node 22 for native TypeScript and WebSocket |

## Green CI run

https://github.com/gianluca-fonseca/streetlens/actions/runs/29668370435

PR: https://github.com/gianluca-fonseca/streetlens/pull/35

All workflow steps passed: `npm ci` → `tsc` → `lint` → `build` → `npm test` (50/50 suites, including `test-capture-migrations.mjs` with Docker).

## Gates (local, verbatim)

```
npx tsc --noEmit: PASS (exit 0)
npm run lint: PASS (exit 0; 1 pre-existing warning in SegmentDetail.tsx)
npm run build: PASS (exit 0)
npm test: PASS (50/50 suites)
node scripts/test-i18n-parity.mjs: PASS — PARITY: OK (identical key sets)
```

## Deviations

- **Node version:** workflow bumped from Node 20 → **22** (not a gate weakening — tests already relied on Node 22+ features; Node 20 could not run three suites honestly).
- **CI trigger:** workflow only fires on `push`/`pull_request` to `main`/`next`; verification used **PR #35 → next** (branch push alone does not trigger CI).
- **No repo secrets added** — placeholders are inline workflow `env` only.
- **Skipped tests:** none in CI. Live-smoke scripts (`live-*.mjs`) are outside `npm test` by design and remain gated behind `RUN_LIVE_SMOKE` / credentials.
