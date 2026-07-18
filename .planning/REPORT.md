# unit-security-core — REPORT

**Verdict: PASS** — PostgREST bypass closed, secrets hardened, submission rate limits added in DB; server code and tests updated; capture UI loads on port 3572 (live session create awaits conductor applying 0025).

## Commits

| Hash | Message |
|------|---------|
| `6fc470b` | feat(db): close PostgREST bypass and harden admin secrets (0025) |
| `8e9ccb2` | feat(security): pass server secret to gated RPCs and fail-closed IP salt |
| `e4e0147` | test(security): cover 0025 contracts and secret-gated RPC signatures |
| `69d8108` | evidence(unit-security-core): browser-drive collect page and API gates |

## Gate results

```
npx tsc --noEmit: PASS
npm run lint: PASS
npm run build: PASS
scripts/test-*.mjs: PASS (32 scripts)
node scripts/test-i18n-parity.mjs: PASS
```

(`scripts/test-capture-migrations.mjs` SKIP — docker unavailable locally; SQL reviewed and integration test updated for 0025.)

## Migrations created

| File | What it does | Server depends? |
|------|----------------|-------------------|
| `0025_security_core.sql` | `assert_admin_secret` (SHA-256 at rest, constant-time compare); rewrites all privileged RPCs to use it; drops old capture create/register/finalize signatures and replaces with secret-gated versions + `validate_capture_track`; drops `submissions_anon_insert` policy; adds `submit_proposal` DEFINER RPC with 20/hour per-IP-hash rate limit; adds `submissions_ip_ix` | **Yes** — `lib/capture/db.ts` and `lib/submissions-sink.ts` call new RPC signatures |

**Conductor action:** Apply `0025_security_core.sql` to live Supabase. Re-seed `admin_rpc_secret` as plaintext in env (`ADMIN_RPC_SECRET`); the migration stores `encode(digest(secret,'sha256'),'hex')` at rest.

## Mandate coverage

| Finding | Addressed |
|---------|-----------|
| 1 PostgREST bypass | Old anon-callable capture RPC signatures dropped; `p_secret` required; null `p_ip_hash` rejected |
| 3 Plaintext admin secret | Hashed at rest; all privileged RPCs use `assert_admin_secret` |
| 5 Default IP salt | `lib/ip.ts` throws in production when `SUBMISSIONS_IP_SALT` unset |
| 7 Submission DB rate limit | `submit_proposal` counts pending rows per `source_ip_hash` (20/hour) |
| 8 Finalize track hygiene | `validate_capture_track` in SQL (bbox, accuracy, span, max speed) |
| 12 Non-constant-time compare | Byte-wise XOR loop in `assert_admin_secret` |
| 2/9 frame leak | **Not touched** (owned by unit-map-diet) |

## Assumptions

- Browser upload flow continues via Next.js API routes only (`lib/capture/upload-client.ts` unchanged); direct PostgREST RPC calls without secret are blocked after migration.
- `capture_session_status` remains anon-callable (uuid capability) — not in mandate revoke list.
- Live capture session create returns 500 until migration applied (observed in api-drive against configured Supabase with pre-0025 schema).

## Deviations

- None.

## Evidence

- `.planning/evidence/unit-security-core/collect-page.png` — `/en/collect` renders on port 3572
- `.planning/evidence/unit-security-core/console-collect.log` — browser console (no errors)
- `.planning/evidence/unit-security-core/api-drive.log` — honeypot 400, pages 200, submission 201 (local sink)
- `.planning/evidence/unit-security-core/GATES.txt` — gate verbatim results
