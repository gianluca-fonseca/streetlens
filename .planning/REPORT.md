# VERDICT: PASS

unit-civic-pack delivered the Ley 7600 compliance brief, scrubbed open-data GeoJSON/CSV (+ gejson alias), and bilingual press kit on port 3583 with no migrations.

## Commits

- `c7f94e1` feat(civic): add municipality config, Ley brief, and open-data builders
- `823f7bf` feat(civic): expose scrubbed open-data GeoJSON and CSV endpoints
- `2a1bb77` feat(civic): ship brief, data, and press pages with print stylesheet
- `d47010b` feat(civic): add EN/ES copy for brief, data, and press surfaces
- `cb92941` test(civic): lock Ley brief aggregations and open-data scrub contract
- `c369d27` fix(civic): allow API download anchors on the open-data page
- `74d8db2` fix(civic): define gejson route locally for Next segment config
- *(evidence + report commit follows this file)*

## Gates (verbatim)

```
npx tsc --noEmit
(exit 0)

npm run lint
> streetlens@0.1.0 lint
> eslint
(exit 0)

npm run build
✓ Compiled successfully
✓ Generating static pages (40/40)
(exit 0)

node scripts/seed-provenance-drive.mjs --clean
npm test
42/42 passed
(exit 0)

node scripts/test-i18n-parity.mjs
PARITY: OK (identical key sets)
(exit 0)
```

## Migrations created

None (mandate: no migrations).

## Assumptions

- Municipality branding is parameterized via `lib/municipality.ts` (`MUNICIPALITY.name` etc.); Escazú remains the configured pilot value, not a new hardcode sprinkled through the civic pages.
- Open-data exports are bounded to segments with published evidence (camera observation and/or field audit), capped at 2000 features.
- “Download PDF” means browser print + `@media print` stylesheet (no server-side PDF renderer).
- Press contact is GitHub Issues / public links (no personal email on the wire).
- Accessibility compliance for the brief uses paint-wire `score_accessibility` (CV paint when no field audit), labeled provisional in copy.

## Deviations

- Mandate path `/api/open-data/gejson` is implemented as an alias; canonical spelling `/api/open-data/geojson` is also shipped (and linked from the data page).
- Brand marks copied to `public/brand/` so press-kit downloads are publicly servable (source SVGs lived under `docs/assets/`).

## Evidence

Port **3583** browser drive + API smoke:

- `.planning/evidence/unit-civic-pack/brief-en-1440.png`
- `.planning/evidence/unit-civic-pack/brief-es-1440.png`
- `.planning/evidence/unit-civic-pack/data-en-1440.png`
- `.planning/evidence/unit-civic-pack/data-es-390.png`
- `.planning/evidence/unit-civic-pack/press-en-1440.png`
- `.planning/evidence/unit-civic-pack/press-es-1440.png`
- `.planning/evidence/unit-civic-pack/console.log` (pages/APIs 200; scrub sample clean; 0 browser console errors)
- `.planning/evidence/unit-civic-pack/console.json` (playwright console dump)

## Surfaces shipped

| Surface | Path |
|--------|------|
| Ley 7600 brief | `/[locale]/brief` |
| Open data docs | `/[locale]/data` |
| Press kit | `/[locale]/press` |
| GeoJSON | `/api/open-data/geojson` (+ `/gejson`) |
| CSV | `/api/open-data/csv` |
