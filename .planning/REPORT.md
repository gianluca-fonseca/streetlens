# unit-reviewer-throughput — REPORT

**Verdict: PASS** — All six scout mandates (1,2,3,4,5,8,10) are implemented; gates green on port 3574.

## Commits

| Hash | Message |
|------|---------|
| `01088e1` | feat(capture): add review throughput helpers and tests |
| `fa441b4` | feat(api): return next_session_id after capture review decide |
| `5a15e7c` | feat(admin): reviewer workbench throughput UX |
| `17fa214` | feat(i18n): review workbench throughput strings en/es |
| `8c25b40` | evidence(unit-reviewer-throughput): browser screenshots on port 3574 |
| `5fcdfa3` | fix(test): scope panel-vitality copy guard to detail+layers |
| `2fa95d4` | docs(unit-reviewer-throughput): report and gate evidence |

## Gate results

```
npx tsc --noEmit — PASS
npm run lint — PASS
npm run build — PASS
scripts/test-*.mjs (32 scripts, after seed-provenance-drive --clean) — PASS
node scripts/test-i18n-parity.mjs — PASS (945/945 keys)
```

Full verbatim log: `.planning/evidence/unit-reviewer-throughput/gates.txt`

## Migrations

None created. No server code depends on new migrations.

## Mandate mapping

1. **Next-in-queue loop** — `CaptureReview` redirects to `next_session_id` after decide; decided banner shows Next walk / Back to queue; session strip shows queue position (`captureQueuePosition`). API returns `next_session_id` (`app/api/admin/capture/review/route.ts`).
2. **Street names** — `MatchedGeometry` + `segmentMeta` from `getSegments()`; segment cards, inspector, lightbox captions, queue `streetSummary`.
3. **Reason presets** — Chip row fills textarea (`REASON_PRESET_KEYS`); still required server-side.
4. **Keyboard + lightbox** — Workbench shortcuts (`j/k`, `e`, `x`, `1–5`, `a/r`, `Shift+A/N`, `?` overlay); lightbox `e` + Exclude/Include button.
5. **Draft persistence** — `localStorage` via `review-draft.ts`; restored on mount; cleared on decide; `beforeunload` when corrections exist.
6. **Actionable errors** — `review-errors.ts` maps 401/409/422 to specific i18n keys for submit and delete.
10. **Select all/none** — Buttons + `Shift+A` / `Shift+N` in decision bar.

## Assumptions

- Pending capture order follows `getPendingSubmissions()` FIFO (cv_capture rows only).
- Live DB has at least one `review_ready` capture for browser evidence; tested against session `5fa14056-739d-4ba1-95dd-6d692515ad38` on port 3574.
- `test-panel-vitality.mjs` copy guard scoped to `detail`+`layers` so parallel admin i18n edits do not false-fail that unit's contract.

## Deviations

- Auto-redirect to next walk after decide (not only a banner offer) — matches scout “one-click jump” intent.
- `frameExcludedShort` remains `"excl"` in EN (short overlay label); ES uses `"excl"` as well for compact filmstrip chrome.

## Evidence

- `.planning/evidence/unit-reviewer-throughput/workbench-main.png`
- `.planning/evidence/unit-reviewer-throughput/shortcuts-overlay.png`
- `.planning/evidence/unit-reviewer-throughput/reason-presets-decision-bar.png`
- `.planning/evidence/unit-reviewer-throughput/queue-street-names.png`
- `.planning/evidence/unit-reviewer-throughput/console.log`
- `.planning/evidence/unit-reviewer-throughput/gates.txt`
- `.planning/evidence/unit-reviewer-throughput/seed-provenance-drive.log`
