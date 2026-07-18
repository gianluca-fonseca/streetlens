# unit-capture-delight — bgsd-0013-frontier-wave

MANDATES (scout: capture-ux #1,2,3,4,6; ui-elevation #9):
1. QR DEEP LINKS: /collect?src=qr&spot=<id> deep-link support with a welcoming first-run explainer for someone who scanned a lamppost QR (EN/ES); a tiny admin page or script that GENERATES printable QR posters for chosen spots (bilingual poster, municipality-parameterized).
2. IN-WALK QUALITY COACH: live capture surfaces gentle feedback (GPS accuracy poor, moving too fast, too dark) using existing client signals; nothing blocks the walk.
3. MY WALKS: local-storage shelf of my sessions with status + street-named rollups (names from segment data), replacing raw ids on the status page.
4. PRE-UPLOAD GATE: before upload, a "ready to send?" summary (frames, duration, coverage estimate, quality flags) with fix hints.
5. WALK RECEIPT: after approval-pending upload, a shareable receipt card (streets walked, frames, date; EN/ES). PORT: 3584. No migrations.

## Contract (identical for every bgsd-0013 unit — violations fail the audit)
You are a build executor working ONLY inside this worktree (your cwd). Branch checked out.
- SCALE DOCTRINE (owner-sealed): Escazú is the pilot, not the architecture. Anything you build must not add NEW hardcoded Escazú/canton assumptions; parameterize municipality/locale where you touch it cheaply (config/constants, not a tenancy rewrite).
- COMMITS: small, conventional, atomic, as you go. NEVER git push.
- GATES (all before done; rerun after fixes): npx tsc --noEmit; npm run lint; npm run build; npm test (run `node scripts/seed-provenance-drive.mjs --clean` first); node scripts/test-i18n-parity.mjs. Every user-facing string EN+ES. Add tests for what you build.
- LIVE DB SACRED: never write the live Supabase. Migrations = SQL files only, using EXACTLY your assigned number (see mandates; no other unit shares it). Conductor applies.
- SECRETS: .env.local present for local runs; never print or commit it.
- EVIDENCE: browser-drive on YOUR port only; screenshots + console log to .planning/evidence/<unit>/ and commit them.
- REPORT (MANDATORY — a unit without it FAILS its audit even if code is perfect): .planning/REPORT.md — verdict line FIRST, commits w/ hashes, gates verbatim one per line, migrations created, assumptions, deviations, evidence list.
- CONTROL: write .planning/CONTROL.json {"status":"done"} or {"status":"failed","reason":"..."} ONLY after the report exists. It currently says running.
- Scout reports with the ranked proposals you are implementing: .planning/scout/*.md — read yours first; they are the spec beside the mandates.
