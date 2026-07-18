# unit-insights — bgsd-0013-frontier-wave

MANDATES (scout: data-insights #1,2,3,6,7,9,12):
1. /[locale]/insights — the public instrument panel: district rollups (computed from segment data, not hardcoded to three names), live worst-streets ranking from canonical camera scores (links to street pages if present, else map), coverage progress (network km observed over time), observation timeline, lens distribution charts. ISR, honest-provenance labels throughout (camera-observed vs audited never conflated).
2. /method + /rubric transparency routes: how scores are made (draw from docs/), the 15 rubric items, the honesty contract, EN/ES.
3. Landing + map link to insights. Charts: no new heavy deps; SVG or lightweight. PORT: 3582. No migrations.

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
