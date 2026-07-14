# u3-contribution — PLAN

Public, anonymous, map-anchored contribution flow. Two paths: propose an update
to an existing segment, and add an unmapped segment by tracing a polyline.
Lands as `status=pending` via Supabase when configured, else a gitignored local
queue file. Anti-spam: hidden honeypot + per-IP in-memory rate limit. Bilingual
(EN canonical + es-CR), design-direction compliant, reusing the established
panel primitive.

## Contracts studied (import, never redefine)
- `lib/schemas.ts` — `submissionSchema` (discriminated union), `addSegmentPayloadSchema`,
  `updateSegmentPayloadSchema`, `highwaySchema`, `parseSubmission`. Server + client validate with these.
- `lib/types.ts` — `SubmissionRow` (DB shape: type, payload jsonb, status, source_ip_hash, honeypot_tripped), `SegmentProperties`.
- `lib/supabase.ts` — `getSupabaseClient()` / `isSupabaseConfigured()` (env-gated, null fallback).
- `supabase/migrations/0005_submissions.sql` + `0006_rls.sql` — anon may INSERT only `status='pending'`,
  reviewed_at/reviewer_note null. Insert shape: `{ type, payload, source_ip_hash, honeypot_tripped }`.
- Design tokens in `app/globals.css`; panel primitive in `components/MapPanel.tsx` / `SegmentDetail.tsx`
  (rounded-[12px]/[8px]/[4px], border-border, bg-surface-elevated, shadow-panel/popover, mono numerals, Lucide @1.75).

## Server (app/api/submissions/route.ts + lib helpers)
1. `lib/ip.ts` — derive client IP from `x-forwarded-for`/`x-real-ip`; `hashIp()` = sha256(ip + salt). Never store raw.
2. `lib/rate-limit.ts` — in-memory token bucket keyed by ip hash (N per window). Documented limitation:
   per-instance, resets on redeploy; fine for MVP, replace with Redis/DB later.
3. `lib/submissions-sink.ts` — `persistSubmission(record)`: insert via Supabase when configured,
   else append to `data/pending-submissions.local.json` (gitignored). Returns `{ sink: 'supabase'|'local' }`.
4. `route.ts` POST:
   - parse JSON; peel `honeypot`. If non-empty → **reject** (400 `{ok:false,error:'rejected'}`), append a
     `honeypot_tripped:true, status:'rejected'` record to the local queue (evidence for admins). No pending row.
   - rate-limit by ip hash → 429 on exceed.
   - `parseSubmission()` (zod) on `{type,payload,contact}` → 400 on invalid with issues.
   - build `SubmissionRow`-shaped record `{type, payload, status:'pending', source_ip_hash, honeypot_tripped:false}`; persist.
   - 201 `{ok:true, status:'pending', sink}`.
   - GET (dev-only helper, guarded) omitted; not needed.

## UI (map-integrated, owned)
- `components/contribute/useContribute.ts` — hook given the live maplibre map + ready flag. Owns:
  contribute state machine (`idle | choose | trace | select | form-add | form-update`), draw sources/layers
  (terracotta line + vertices), click/dblclick vertex capture, undo/clear/finish, and submit via fetch.
- `components/contribute/ContributeUI.tsx` — the FAB ("Contribute") + choose panel (two paths) +
  AddSegmentForm (name, highway select, note, coords readout) + UpdateSegmentForm (prefilled name, highway,
  note, required reason) + pending-confirmation state + hidden honeypot input. Reuses panel primitive.
- `components/AuditMap.tsx` — surgical integration: call the hook, render `<ContributeUI/>`, and gate the
  existing segment click (in `select` mode → open update form instead of detail; in `trace` mode → ignore).

## Anti-spam / honesty
- Honeypot field name `website` (hidden, aria-hidden, tabindex -1, off-screen). Server rejects if filled.
- Confirmation copy: honest "pending review" — never implies live/published data.

## i18n
- New `contribute` namespace in `messages/en.json` (canonical) + complete `messages/es.json`.

## Verification
- `npm run build` + `npm run lint` green.
- Playwright: BOTH paths (trace-new, propose-update) → pending submission via local fallback (assert queue file grows, status pending).
- Honeypot: direct POST with filled honeypot → 400 rejected; pending count unchanged.
- Screenshots of both flows + confirmation to `.planning/evidence/`.

## Boundaries respected
Own: app/api/submissions, components/contribute, AuditMap integration, messages additions, lib server helpers (new files).
Never touch: supabase/migrations, lib/segments.ts, lib/schemas.ts, lib/types.ts (import only), admin surfaces.
