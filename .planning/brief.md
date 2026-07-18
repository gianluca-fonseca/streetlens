# unit-quality-privacy — bgsd-0013-frontier-wave

MANDATES (scout: robustness-residue #2,3; ui-elevation #2) — SECURITY-RELEVANT:
1. ES CAMERA ASSESSMENTS: the synthesis stage emits locale-aware assessment text — store EN + ES variants (extend synthesis to produce both in ONE call; bounded tokens; fall back to EN if ES missing). Public surfaces show the viewer locale; existing English-only rows keep working. MIGRATION NUMBER ASSIGNED: 0028 (community_cv_observations.assessment_es or a jsonb locale map; your design, justify in report).
2. PRIVATE FRAMES: new private storage policy for capture frames + signed-URL access for admin surfaces and the extraction pump; PUBLIC surfaces must not expose raw frame URLs. Keep the contributor upload path working (signed upload). Design the migration into 0028 as well (one file, both concerns, clearly sectioned).
3. EVIDENCE STRIP: segment detail (public) gets a small evidence strip of frames ONLY where policy allows: serve via time-limited signed URLs through a server route with the same scrub discipline; if that conflicts with privacy, propose-and-implement the safest visible alternative (e.g. blurred thumbnails) and justify. PORT: 3585.

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
