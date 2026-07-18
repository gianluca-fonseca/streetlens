# unit-capture-delight — REPORT

**VERDICT: PASS**

## Commits

| Hash | Message |
|------|---------|
| `086ea49` | feat(capture): add delight core libs and public segment brief API |
| `0819abd` | test(capture): add capture-delight unit test suite |
| `08f4389` | feat(collect): QR onboarding, quality coach, gate, walks shelf, and receipt |
| `6acfc52` | feat(admin): bilingual QR poster generator for lamppost recruitment |

## Gates (verbatim)

```
npx tsc --noEmit — PASS (exit 0)
npm run lint — PASS (exit 0)
npm run build — PASS (exit 0)
npm test — PASS (42/42 suites, after node scripts/seed-provenance-drive.mjs --clean)
node scripts/test-i18n-parity.mjs — PASS (1038/1038 keys EN+ES)
```

## Migrations created

None (unit mandate: no migrations).

## Assumptions

- Port **3584** for local browser evidence (`PORT=3584 npm run dev`).
- Municipality display names come from `NEXT_PUBLIC_MUNICIPALITY_NAME_EN/ES` (defaults are generic, not pilot-specific).
- Segment street names on the status page are fetched client-side from `GET /api/segments/[id]/brief` (no DB/RPC change).
- Quality-coach thresholds (`SPEED_WARN_MPS`, `DARK_GRAY_THRESHOLD`) are initial estimates, matching scout risk note.
- Walk receipt share uses Web Share API with clipboard fallback.

## Deviations

- Scout proposal #1 used `street=` alias; implemented primary param `spot=` per unit mandate, with `street=` accepted as fallback in `parseCollectDeepLink`.
- QR poster CLI duplicates minimal HTML builder inline (script is self-contained); admin API uses shared `lib/capture/qr-poster.ts`.

## Evidence

Browser drive on port 3584:

- `.planning/evidence/unit-capture-delight/01-qr-explainer.png` — QR deep link welcome (`/en/collect?src=qr&spot=esc-sa-0001`)
- `.planning/evidence/unit-capture-delight/02-collect-chooser.png` — collect chooser with My walks shelf
- `.planning/evidence/unit-capture-delight/03-status-street-names.png` — status page with street-named rollups (fixture `3f7a1c92-…`)
- `.planning/evidence/unit-capture-delight/console-collect.log` — browser console capture
- `.planning/evidence/unit-capture-delight/qr-poster-esc-sa-0001.html` — generated bilingual poster
- `.planning/evidence/unit-capture-delight/GATES.txt` — gate results summary
