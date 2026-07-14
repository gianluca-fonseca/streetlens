# u4-admin — Verification evidence

Branch `unit/u4-admin`. Verified against a production build (`next build` +
`next start`, port 3111) with `.env.local` (ADMIN_PASSWORD, ADMIN_RPC_SECRET)
and no Supabase configured (so the local/SAMPLE path is exercised).

## Quality gates

- `npm run lint` — clean (no warnings/errors).
- `npm run build` — success; 14 routes generated. `/[locale]/admin` and
  `/[locale]/admin/queue` are dynamic (force-dynamic); `/[locale]/admin/login`
  is prerendered (form wrapped in Suspense for the CSR-bailout rule).

## Auth gate (curl, server-side)

| Check | Result |
| --- | --- |
| Unauthenticated `GET /en/admin` | `307` → `/en/admin/login?from=%2Fen%2Fadmin` |
| `POST /api/admin/login` wrong password | `401` |
| `POST /api/admin/login` correct password | `200` + `Set-Cookie: sl_admin_session` (httpOnly) |
| Authenticated `GET /en/admin` | `200` |
| `POST /api/admin/review` without cookie | `401` (handler re-verifies; proxy excludes /api) |

## Playwright evidence (screenshots)

- `admin-01-login.png` — login gate.
- `admin-02-login-wrong-password.png` — wrong password blocked ("Incorrect password.", still on /login).
- `admin-03-dashboard.png` — dashboard with the real dataset: 535 segments, 76.8 km,
  80.3% coverage, 29% fail Ley 7600, pending 3 / approved 0 / rejected 0, San Antonio
  district row (535, avg overall 66).
- `admin-04-queue-pending.png` — 3 SAMPLE pending items: two add_segment (geometry
  preview + name/road-type/note), one update_segment showing a current-vs-proposed
  diff (Name "Calle 130" → proposed; Road type "residential" → "tertiary") joined
  from the real segment esc-sa-0001, plus the SAMPLE-source demo note.
- `admin-05-queue-after-approve-reject.png` — after approving item 1 (with a reason)
  and rejecting the edit (with a reason): "1 submission awaiting review" remains.
- `admin-06-dashboard-after-review.png` — counts updated: pending 1 / approved 1 /
  rejected 1 (dataset figures unchanged).
- `admin-07-queue-es.png` — Spanish locale (bilingual), session valid cross-locale.

## Notes

- Right-password value is redacted here; it comes from `.env.local`.
- Approve/reject in local mode write to the gitignored overlay
  (`data/submission-reviews.local.json`) and stage approvals to
  `data/approved-submissions.local.json`; live application to segments is a
  post-DB step (admin never writes to segments).
