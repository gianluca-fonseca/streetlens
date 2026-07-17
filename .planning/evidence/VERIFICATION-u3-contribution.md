# u3-contribution — Verification evidence

Run: sesh-1784059200603 · branch `unit/u3-contribution` · advisor rev 2.

Public, anonymous, map-anchored contribution flow: trace an unmapped segment or
propose a correction to an existing one. Lands `status=pending` via Supabase when
configured, else a gitignored local queue. Honeypot + per-IP rate limit.

## 1. Build + lint + typecheck (green)

- `npx tsc --noEmit` → clean (exit 0).
- `npm run lint` → clean (0 errors, 0 warnings).
- `npm run build` → compiled successfully; TypeScript passed; `/en` + `/es`
  prerendered; `/api/submissions` registered as a dynamic (ƒ) route.

## 2. Server route — API-level proof (`app/api/submissions/route.ts`)

Direct `curl` against the running dev server. Validation reuses the frozen
`lib/schemas.ts` zod schemas (imported, not redefined). Evidence in
`api-test-queue.json`.

| # | Request | Result |
| --- | --- | --- |
| 1 | valid `add_segment` (4 CR coords) | `HTTP 201 {"ok":true,"status":"pending","sink":"local"}` |
| 2 | valid `update_segment` (patch + reason) | `HTTP 201 {"ok":true,"status":"pending","sink":"local"}` |
| 3 | **honeypot filled** (`"honeypot":"http://spam.example"`) | `HTTP 400 {"ok":false,"error":"rejected"}` |
| 4 | out-of-CR coordinates | `HTTP 400 {"ok":false,"error":"invalid", issues:{…}}` (zod bbox error) |

Local queue after the API test (`api-test-queue.json`): 3 records — 2 pending
(non-honeypot), 1 flagged `honeypot_tripped:true, status:"rejected"` (kept OUT of
the pending count, visible to admins per advisor rev 2 note 1). Every record
carries a salted `source_ip_hash` (sha256, never the raw IP); the honeypot record
stores no submitted payload (`{"rejected":"honeypot"}`).

## 3. Both UI paths — Playwright, real map interaction

Driven in an isolated browser context against `http://localhost:3311/en`
(the shared default page was being hijacked by a concurrent run). 0 console
errors across the whole run.

### Path A — trace an unmapped segment (`sl-01`…`sl-05`)
Contribute FAB → "Add a missing street" → four `page.mouse.click` points on the
map canvas (live terracotta dashed line + vertices rendered) → "4 points",
Finish enabled → add form (name, street type, condition tiers, note, photo
placeholder) → Submit → **"Submitted for review"** pending confirmation.

### Path B — propose a correction (`sl-06`…`sl-08`)
"Contribute another" → "Propose a correction" → click a mapped segment (form
prefilled with its name, e.g. "Acceso 2") → answer an accessibility tier + a
required reason → Submit → **"Submitted for review"**.

Live queue after both UI submissions (`data/pending-submissions.local.json`,
gitignored — inspected, not committed): **2 pending, 0 honeypot**:

```
add_segment  pending  payload.coordinates = 4 real Escazú lng/lat points
                      payload.note = "[Condition report] Walking surface: Some
                      cracks or bumps · Drainage: Floods often — Sidewalk narrows…"
update_segment pending payload.segment_id = "esc-sa-0438"
                      patch.note = "[Condition report] Accessibility: Not
                      wheelchair-friendly"; reason = "No curb ramp at this corner…"
```

### Bilingual (`sl-09`)
`/es` renders the full flow in es-CR voseo ("Ayudá a mapear Escazú",
"Agregá una calle que falte…", "Proponer una corrección").

Screenshots: `sl-01-map` … `sl-09-es-choose` in this folder.

## 4. Honeypot rejection

Proven at the API level (§2 row 3: `HTTP 400 rejected`, no pending row created).
The UI field is hidden off-screen (`name="website"`, `tabindex=-1`,
`aria-hidden`), so a human never fills it; a filled value is rejected server-side
and recorded flagged for admin review.

## Design-direction compliance

Reuses the established panel primitive (rounded 12/8/4, `border-border`,
`bg-surface-elevated`, `--shadow-popover`, mono numerals, Lucide @1.75, pine/
terracotta only). No new panel style, no ban-list patterns. Forms dock right to
clear the top-left stats panel; the small FAB/toolbar/confirmation sit
bottom-left. AA: the primary button uses a fixed dark pine (`#1F5C4A`) with white
text so it clears 4.5:1 in both light and dark themes (the pine token lightens in
dark mode). The dark "N" in dev screenshots is the Next.js dev-mode indicator
(dev-only; absent in production).

## Assumptions / items for Conductor adjudication

1. **Condition tiers vs the frozen schema.** `addSegmentPayloadSchema` /
   `updateSegmentPayloadSchema` carry no per-layer numeric fields, and zod strips
   unknown keys, so the advisor's per-layer condition inputs are captured in the
   UI and **compiled into the accepted `note` / `patch.note` text** as a readable
   "[Condition report] …" block rather than invented 0-100 numbers. A submission
   is a human-reviewed proposal, so the reviewer gets the context without the
   schema drifting. Flagged for adjudication (logged in the control file).
2. **Rate limit is in-memory** (per-instance, resets on redeploy) — documented in
   `lib/rate-limit.ts` and the route header per advisor rev 2 note 4. Swap for
   Redis/Postgres to harden without touching the route.
3. **Contact field** is truly optional, labeled "(optional)" in both locales, and
   nothing else person-identifying is collected (IP is hashed only) — advisor
   rev 2 note 2.
4. **Live Supabase insert path is code-complete but unexercised over HTTP** (no
   PostgREST gateway tonight): `persistSubmission` inserts a `pending` row when
   configured (satisfying the 0006 anon-insert RLS check) and otherwise falls
   back to the local queue, which is what tonight's evidence exercises.
