# unit-insights — REPORT

**PASS** — Public insights instrument panel, method/rubric transparency routes, landing+map links, EN/ES, gates green, evidence on :3582.

## Commits

- `be2b8c5` — feat(insights): add municipality config and insights aggregations
- `7b2fbf8` — feat(insights): ship insights, method, and rubric public surfaces
- `68840e8` — docs(insights): add evidence, REPORT, and done control

## Gates (verbatim)

```
npx tsc --noEmit: PASS
npm run lint: PASS
npm run build: PASS
npm test: PASS
node scripts/test-i18n-parity.mjs: PASS
```

Lint log: `✔ No ESLint warnings or errors`  
i18n: `PASS — en.json and es.json key trees match.`  
Build: Next.js compiled successfully; routes `/[locale]/insights`, `/[locale]/method`, `/[locale]/rubric` present.  
Tests: full `npm test` suite including new `scripts/test-insights.mjs` — PASS.

## Migrations created

None (mandate: no migrations).

## Assumptions

1. Street report cards (`/[locale]/street/[id]`) are owned by unit-street-card; this worktree prefers them when the route file exists, otherwise links rankings to `/map?segment=&layer=`.
2. District names are derived from `segment.properties.district` at read time — never a hardcoded three-district list.
3. Municipality display name comes from `lib/municipality.ts` (`NEXT_PUBLIC_MUNICIPALITY_*` overrides); Escazú remains the default pilot label only.
4. Paint wire omits `cv_observations`; worst-street ranking uses `cv_*` stubs; walk dates for ranking/timeline come from a scrubbed CV observation read (no `session_id` / `frame_refs` on the page).
5. MapLibre “Expected value to be of type number, but found null” warnings on `/map` are pre-existing and unrelated to the new document surfaces.

## Deviations

1. Hero real-data rail prefers **lowest camera scores** when stubs exist (scout #2), falling back to recently-observed chronology when scores are absent.
2. Method landing section still keeps illustrative demo anatomy; full transparency lives on `/method` and `/rubric` as mandated.
3. No new chart libraries — SVG bar + sparkline only.

## Evidence

Port **3582** browser drive:

- `.planning/evidence/unit-insights/01-insights-en.png`
- `.planning/evidence/unit-insights/02-method-en.png`
- `.planning/evidence/unit-insights/03-rubric-en.png`
- `.planning/evidence/unit-insights/04-insights-es.png`
- `.planning/evidence/unit-insights/05-method-es.png`
- `.planning/evidence/unit-insights/06-rubric-es.png`
- `.planning/evidence/unit-insights/07-landing-en.png`
- `.planning/evidence/unit-insights/08-map-en.png`
- `.planning/evidence/unit-insights/console.log`
- `.planning/evidence/unit-insights/GATES.txt`
- `.planning/evidence/unit-insights/{tsc,lint,build,test,i18n-parity,server}.log`

## Delivered (scout mandates)

| # | Item | Status |
|---|---|---|
| 1 | `/[locale]/insights` instrument panel | Done (ISR `revalidate=300`) |
| 2 | Live worst-streets from canonical camera scores | Done (+ hero rail) |
| 3 | District rollups from segment data | Done |
| 6 | `/method` + `/rubric` transparency | Done EN/ES |
| 7 | Coverage progress (km + cumulative sparkline) | Done |
| 9 | Observation timeline | Done (scrubbed) |
| 12 | Lens distribution charts (SVG) | Done |
| — | Landing + map link to insights | Done |
| — | Honest provenance labels | Done throughout |
