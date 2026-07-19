# unit-reviewer-dialogue — REPORT (bgsd-0015)

## Verdict

**PASS** — Reviewer can chat with the synthesis model per segment, cite frames as `#N` / `#N-M` pills, converse (with clarifying questions), and recompute assessment EN+ES + lens scores with human corrections as ground truth. Migration 0036 filed (conductor applies). Gates green. Live browser evidence on :3590 with two real text-only OpenAI calls (≪ \$1).

## Commits

| Hash | Message |
|------|---------|
| `04b8700` | feat(dialogue): add text-only guided chat engine core |
| `485f081` | feat(dialogue): persist chat, wire workbench UI and API |
| `c6b58b1` | chore(dialogue): drop unused vars in context assembly |
| `354873e` | test(dialogue): browser evidence on :3590 plus lint fixes |

## Gates (verbatim)

```
=== npx tsc --noEmit ===
(exit 0 — clean)

=== npm run lint ===
> streetlens@0.1.0 lint
> eslint
… SegmentDetail.tsx pre-existing warning only (cvOverallAssessment unused)
✖ 1 problem (0 errors, 1 warning)
(exit 0)

=== npm run build ===
✓ Compiled successfully
✓ Generating static pages (54/54)
Route includes ƒ /api/admin/capture/dialogue
(exit 0)

=== npm test (seed clean first) ===
51/51 passed
including [PASS] test-guided-dialogue.mjs

=== node scripts/test-i18n-parity.mjs ===
en leaf keys: 1396
es leaf keys: 1396
only in en: 0 []
only in es: 0 []
PARITY: OK (identical key sets)
(exit 0)
```

Full gate scrapes: `.planning/evidence/reviewer-dialogue/GATES.txt` (and this session’s prior full `npm test` / `npm run build` logs).

## Prompt design summary

**Converse** (`converseSystemPrompt`): text-only; rollup + spatial block + cited-frame evidence + transcript; ask clarifying questions when unsure; set `suggest_recompute` when ready. Never rewrites scores.

**Recompute** (`recomputeSystemPrompt`): same context; reviewer messages are ground truth; rewrite EN+ES assessment (synthesis schema) + lens deltas with reasons citing the correction / `#N`; may exceed autonomous ±20; overall never model-set — `renormalizedOverall` (0.45/0.30/0.25, bike separate) in `applyGuidedAssessment`.

**Spatial block** (owner extension): assembled fresh every call — segment identity, traversal anchors, neighbors from `buildGraph`, per-cited-frame %/metres along geometry. Never persisted as standing model state.

## Token-budget math

| Piece | Policy |
|-------|--------|
| Cap | `DIALOGUE_INPUT_TOKEN_CAP = 8000` (~chars/4) |
| Always keep | rollup + spatial + referenced-frame evidence |
| Truncate first | oldest transcript turns |
| Last resort | trim evidence lines / hard-slice |
| Models | `synthesisModel()` → `gpt-5.4-mini` (text-only Responses API; no vision) |
| Ledger | recompute writes usage into `capture_segment_rollups.synthesis_*_tokens` via `setSegmentAssessment` (same seam as re-run analysis); converse returns usage in API JSON |

Unit test locks: 80 long turns → under 8k with truncatedTurns > 0; lower 2500 cap still keeps rollup+spatial.

## Evidence

`.planning/evidence/reviewer-dialogue/`

| File | What it shows |
|------|----------------|
| `01-workbench-with-chat.png` | Chat panel on segment cards |
| `02-pills-in-draft.png` | `#1` / `#2` pills while drafting |
| `03-converse-reply.png` | Live model understood sidewalk correction |
| `04-after-recompute.png` | Scores+assessment updated; Human-corrected |
| `playwright-drive.txt` | Reproduce steps + before/after numbers |
| `server.log` | Two `POST /api/admin/capture/dialogue 200` |
| `snapshot-initial.md` | a11y tree with dual send buttons |

Live drive (fixture mode :3590): accessibility **7 → 23**, overall **12 → 21**; assessment rewritten to continuous sidewalk; 4 persisted dialogue messages (2 recompute-tagged).

**OpenAI spend:** 1 converse + 1 recompute, text-only mini. Estimated ≪ \$0.10 (well under \$1 cap).

## Assumptions

1. Migration **0036** is file-only; conductor applies to live DB (live DB sacred).
2. Worktree migrations stop at 0033; next number is **0036** per brief (no inventing 0034/0035).
3. Map `SegmentProperties` lacks `highway`/`length_m`; spatial length is derived from geometry haversine.
4. Dialogue list is a **sibling RPC** (`capture_list_review_dialogues`), not inlined into `capture_session_review` (avoids colliding with the large review RPC).
5. Converse does not overwrite synthesis ledger tokens; recompute does (same absolute write pattern as re-run synthesis).
6. Fixture mode (empty Supabase URL) used for browser evidence; OpenAI key from `.env.local`.

## Deviations

1. `bgsd-unit.json` in the worktree still describes an older docs unit; **brief.md is authoritative** for this lane.
2. Token spend on converse is returned in the HTTP response but not folded into rollup columns (avoids clobbering prior synthesis spend with a small chat call).
3. Pre-existing lint warning in `SegmentDetail.tsx` left untouched (out of scope).
