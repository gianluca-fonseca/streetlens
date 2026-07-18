# unit-street-card — REPORT

**Verdict: PASS**

## Commits

| Hash | Message |
|------|---------|
| `73c4378` | feat(street): add street card data layer and URL helpers |
| `4618d74` | test(street): add street card contract suite |
| `25a2d95` | feat(street): add shareable report card page with dynamic OG image |
| `8c6ed12` | feat(street): wire deep links from map, hero list, and detail panel |
| `de86706` | chore(evidence): capture unit-street-card browser drive on port 3581 |

## Gates (verbatim)

```
npx tsc --noEmit — exit 0
npm run lint — exit 0
npm run build — exit 0
node scripts/seed-provenance-drive.mjs --clean && npm test — 42/42 passed
node scripts/test-i18n-parity.mjs — PARITY: OK (identical key sets)
```

## Migrations created

None (unit mandate: no migrations).

## Assumptions

- Street card pages use district names from segment data (not hardcoded municipality strings in routes).
- OG images use Satori flex layout (`display: flex` on all multi-child containers).
- `getStreetCard` returns null for unknown segments or segments with no measurable data (404).
- Seeded `esc-sa-0001` is the primary verification segment in real-data era tests.

## Deviations

- Scout suggested `/map?seg=`; implemented `?segment=` per unit mandate.
- Hero map tap still opens `/map` without segment (mandate only required CV list → street pages).
- OG image verified via curl (Playwright cannot render binary PNG routes in this harness).

## Evidence

Browser drive on port 3581 (`.planning/evidence/unit-street-card/`):

- `street-page-en.png` — EN report card for esc-sa-0001
- `street-page-es.png` — ES report card for esc-sa-0001
- `map-segment-deeplink.png` — `/en/map?segment=esc-sa-0001` with panel + Copy link
- `og-street-card-en.png` — dynamic OG image (1200×630 PNG)
- `console.log` — browser console (0 errors on street/map flows)
