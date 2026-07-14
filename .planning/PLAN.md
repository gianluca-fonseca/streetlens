# PLAN — u4-admin: Admin dashboard + verification queue

Scale: feature. Base: `next` (wave 1 merged). Branch: `unit/u4-admin`.

## Binding constraints

- Design: `docs/design-direction.md` (editorial, data-dense, MIT-CDDL tone; mono
  numerals; soft-depth; non-uniform radius 4/8/12; Phosphor/Lucide one stroke
  weight; zero emoji; BAN LIST enforced). Reuse the established panel primitive
  vocabulary from `MapPanel`/`SegmentDetail`/`Legend`.
- Admin RPC posture (`supabase/README.md`): no service-role key. Approve/reject
  goes through the `admin_review_submission` SECURITY DEFINER RPC authenticated
  by `ADMIN_RPC_SECRET` when the DB is present; local fallback otherwise. NEVER
  write to segments from admin code.
- Bilingual EN/ES throughout.
- Do NOT touch: `supabase/migrations`, `lib/segments.ts` internals, public map
  surfaces.

## Key architectural decisions

1. **`proxy.ts`, not `middleware.ts`.** Next.js 16 renamed `middleware` →
   `proxy` and supports exactly ONE such file per project; next-intl already owns
   `proxy.ts`. Creating `middleware.ts` would be silently ignored. So the admin
   auth guard is *composed into the existing `proxy.ts`* alongside the next-intl
   proxy. (Assumption logged for Conductor — the unit boundary named
   `middleware.ts`; the Next 16 equivalent is `proxy.ts`.)
2. **Defense in depth.** Proxy does an optimistic cookie check to redirect
   unauthenticated `/[locale]/admin/**` page requests to the login page. The
   proxy matcher excludes `/api`, so every `/api/admin/*` route handler
   *independently* re-verifies the session cookie (the Next 16 docs explicitly
   recommend verifying auth inside handlers, not relying on proxy alone).
3. **Session = signed cookie, no accounts.** HMAC-SHA256 via Web Crypto
   (`crypto.subtle`, available in both proxy and route-handler runtimes). Signing
   key derived from `ADMIN_PASSWORD`. httpOnly + sameSite=lax + secure-in-prod
   cookie `sl_admin_session`, 12h expiry. Login rate-limited in-memory per IP.
4. **Submissions data layer with local fallback.** Reading order: Supabase
   (best-effort) → local queue file `data/pending-submissions.local.json`
   (u3's runtime output, gitignored) → committed `data/pending-submissions.sample.json`
   (clearly-labeled demo fixtures so the queue renders out of the box). Review
   state in local mode is an immutable-base + overlay design:
   `data/submission-reviews.local.json` records status/reason overlays and
   approvals are staged to `data/approved-submissions.local.json` (both
   gitignored). Live application of approved data is a post-DB step (per advisor).
5. **Map preview = self-contained SVG.** Queue items render an inline SVG
   polyline of the geometry (no tiles, no MapLibre instance) — light, deterministic,
   evidence-friendly. add_segment shows proposed geometry; update_segment shows the
   current segment geometry plus a field-by-field text diff (current vs proposed).

## u3 coordination (dependency not yet landed)

`lib/schemas.ts` defines `submissionSchema` (discriminated union add_segment /
update_segment) and `lib/types.ts` defines `SubmissionRow`/`SubmissionStatus`.
The local queue file shape is defined here from those: an array of records shaped
like `SubmissionRow` (`id`, `type`, `payload`, `status`, `created_at`, optional
`contact`). Fixtures validate their `payload` against `submissionSchema`. If u3
lands a different local-file shape, reconcile on the file path/shape only.

## RLS gap (item for Conductor)

`supabase/README.md` gives only `admin_review_submission` and `admin_stats` RPCs;
the `submissions` table is INSERT-only under RLS and NOT readable by anon. There
is no `admin_list_pending` RPC to list the queue from the DB. Since the DB does
not exist yet, the local path serves everything today. The DB list path is
implemented best-effort (select → null under RLS → falls back to local) and the
missing list RPC is flagged for u2/Conductor.

## Files (all within unit boundary)

- `lib/admin-auth.ts` — session sign/verify, password check, rate limiter.
- `lib/submissions.ts` — read/count/review submissions (Supabase | local | sample).
- `proxy.ts` — compose next-intl proxy + admin page guard (MODIFIED).
- `app/api/admin/login/route.ts`, `.../logout/route.ts`, `.../review/route.ts`.
- `app/[locale]/admin/layout.tsx` — admin shell (nav, locale, logout).
- `app/[locale]/admin/page.tsx` — dashboard (stat tiles + district table).
- `app/[locale]/admin/login/page.tsx` — login form.
- `app/[locale]/admin/queue/page.tsx` — verification queue.
- `components/admin/StatTiles.tsx`, `StatusBadge.tsx`, `GeometryPreview.tsx`,
  `QueueList.tsx`, `LogoutButton.tsx`.
- `data/pending-submissions.sample.json` — committed demo fixtures.
- `messages/en.json`, `messages/es.json` — `admin` namespace.
- `.gitignore` — ignore local runtime submission files.

## Status color mapping (semantic, no orphan dots)

pending → amber `#E8B84B` · approved → pine `var(--pine)` · rejected → clay `#C0472B`.
Always paired with a text label; never a lone status dot.

## Commit plan (atomic, explicit pathspecs)

1. Auth foundation: `lib/admin-auth.ts`, `proxy.ts`, login/logout API, login page, admin messages.
2. Submissions data layer: `lib/submissions.ts`, sample fixtures, `.gitignore`.
3. Review API: `app/api/admin/review/route.ts`.
4. Admin UI components: `components/admin/*`.
5. Admin shell + dashboard + queue pages + remaining messages.

## Verification

`npm run build` + `npm run lint` green. Playwright: wrong password blocked, right
password admits; queue renders fixture pending items; approve + reject with reason
update state; dashboard stats show real dataset numbers (535 segments, 76.84 km,
80.3% coverage). Screenshots → `.planning/evidence/`.
