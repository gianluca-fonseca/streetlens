# unit-civic-pack — bgsd-0013-frontier-wave

MANDATES (scout: product-strategy #2,5,12; data-insights #8,11):
1. LEY 7600 COMPLIANCE BRIEF: /[locale]/brief — a print-ready, bilingual municipal briefing: accessibility-lens compliance summary per district, worst corridors, methodology note, honest provenance disclaimer (camera-observed evidence, pending field audit). Print stylesheet; "Download PDF" via browser print. Parameterized municipality name/branding from config.
2. OPEN DATA: /api/open-data/gejson + csv endpoints (bounded, scrubbed: no session ids/frame refs/contacts — reuse the paint-payload scrub rules) + an /[locale]/data page explaining license + fields; download buttons.
3. PRESS KIT: /[locale]/press — bilingual one-pager: what StreetLens is, the pilot, key figures (live from getStats), contact, brand assets. PORT: 3583. No migrations.

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
