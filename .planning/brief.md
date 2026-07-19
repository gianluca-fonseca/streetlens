# unit-reviewer-dialogue — argue with the model and win (bgsd-0015)

Owner directive (paraphrased faithfully): overriding scores is not enough —
the written analysis stays wrong. The reviewer needs a CHAT with the model,
per segment, in the capture review workbench: describe the miscue ("there IS
a sidewalk present throughout"), reference frames with #14 or ranges #1-9
(rendered as pills in the UI), have the model ask clarifying questions, and
then RECOMPUTE ASSESSMENT AND SCORES — rewriting the segment's assessment
prose (EN+ES) and adjusting lens scores with the reviewer's corrections as
ground truth. No frame-by-frame re-vision (public surfaces only show segment
rollups); TEXT-ONLY calls on the cheap synthesis model. Token-efficient.

MANDATES:
1. CHAT ENGINE (lib/extraction/guided-*): text-only calls to the existing
   synthesis model (gpt-5.4-mini via existing config; NO vision calls).
   Context assembly, token-lean: segment rollup (scores, item medians,
   current assessment), the synthesis evidence lines ONLY for frames the
   reviewer references (#N / #N-M), plus the chat transcript. Two modes:
   - CONVERSE: model replies conversationally; tries to understand the
     correction; asks clarifying questions when genuinely unsure; when it
     believes it understands, it says so and SUGGESTS recompute (a machine-
     readable flag in its structured reply so the UI can light the button).
   - RECOMPUTE: model produces the corrected assessment (EN+ES, same
     structure as synthesis output) + adjusted lens scores. Reviewer-guided
     recompute may exceed the autonomous ±20 clamp — the human authorized
     it — but every changed lens needs a stated reason referencing the
     correction, overall is recomputed by the sealed formula (0.45/0.30/0.25
     renormalized, bike separate), and the result marks the observation
     human_corrected=true with the chat as audit trail. Token accounting into
     the existing synthesis ledger fields.
2. PERSISTENCE — MIGRATION 0036 (yours alone): capture_review_dialogues
   (session_id, segment_id, role, content, created_at, plus a recompute
   marker on messages that triggered one). Secret-gated RPCs to append/list;
   chat survives refresh; included in capture_session_review or a sibling
   read so the workbench loads it. Live DB SACRED — file only, conductor
   applies.
3. UI (workbench, per segment): chat panel; input parses #N and #N-M into
   frame PILLS (clickable → opens that frame in the inspector; invalid refs
   marked); TWO SEND BUTTONS: "Converse" and "Recompute assessment & scores".
   Recompute also lights up/preselects when the model suggested readiness.
   Works after a single message (converse first is optional, per owner).
   Streaming or spinner acceptable; EN/ES strings; keyboard: Enter=Converse,
   Cmd+Enter=Recompute.
4. After recompute: rollup + workbench refresh live (reuse the existing
   re-run-synthesis/refresh plumbing where possible); recomputed values flow
   into the approval payload exactly like human overrides do today (provenance
   honest). The pre-existing per-item override UI stays; this complements it.
5. Cost guardrails: per-dialogue-message input cap (~8k tokens; truncate
   oldest turns first, keep the rollup + referenced frames), and log token
   spend per call to the ledger.

## Contract (bgsd-0015 standard — violations fail the audit)
Worktree-only; small conventional commits; NEVER push. GATES: npx tsc
--noEmit; npm run lint; npm run build; npm test (seed clean first);
node scripts/test-i18n-parity.mjs. Unit tests for: frame-ref parsing
(#N, #N-M, mixed, invalid), context assembly token bounds, recompute score
merge + provenance. Browser-drive evidence on port 3590 (chat with pills,
clarifying answer, recompute updating scores+assessment) into
.planning/evidence/reviewer-dialogue/ and commit. OPENAI spend allowed
sparingly (<$1) to validate live; record it.
REPORT (MANDATORY): .planning/REPORT.md — verdict first, commits, gates
verbatim, prompt design summary, token-budget math, evidence list,
assumptions, deviations. CONTROL: .planning/CONTROL.json {"status":"done"|
"failed"} only after the report exists; currently running.

## OWNER EXTENSION (before build start)

Owner verbatim: "should have the context of at least some semblance of the
map, etc. and details, everything. crucially, it's only passed in any context
when we invoke it, so we don't unnecessarily waste tokens."

Therefore, mandate 1's context assembly gains a SPATIAL BLOCK, textual and
compact (no images), built FRESH at each invocation and never persisted or
sent between turns as standing state:
- segment identity: name, district, length_m, highway class;
- traversal facts: direction, frame count, coverage %, match confidence,
  which frames sit at start / middle / end of the segment (positions along
  the segment derived from stored frame GPS);
- immediate surroundings: names of the connected/neighboring segments at each
  end (from the network graph data already in the repo);
- for each REFERENCED frame (#N pills): its position along the segment
  (e.g. "frame 14 ≈ 60% along, near the Calle X junction") beside its stored
  observation line.
The model must be able to reason like "the sidewalk you saw at #3 and #18
bookends the span the reviewer disputes" with distances in meters.
STATELESSNESS RULE (owner-critical): every call assembles exactly what that
call needs — rollup + spatial block + referenced frames + transcript tail
within the token cap — and nothing else, nothing cached server-side between
turns beyond the persisted chat text itself.
