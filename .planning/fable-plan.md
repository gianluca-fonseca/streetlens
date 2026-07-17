# Conductor seed — u31 cv funnel docs (wave 3)

Documentation lane. Everything is merged on the rehearsal branch when you start; read the
actual shipped code and document truth, not intention. No app code changes (docs/, README
only). Atomic commits + Co-Authored-By trailer. Writing rules: declarative, EN prose,
no em dashes (repo copy rule), mermaid for diagrams.

## Deliverable: rewrite `docs/cv-funnel.md` from skeleton to the definitive doc
1. **Overview**: the three intake paths (manual audit / live recording / video upload)
   and how they converge on the same review loop. One mermaid flow diagram.
2. **Architecture**: capture engine (visibility gating, dedupe, blur filter, OPFS),
   upload (direct-to-storage with registration-armed RLS), map matching (HMM parameters,
   junction handling, sub-trajectories), extraction (model, single all-lens structured
   call, prompt caching, escalation), aggregation (weighted medians → lens scores),
   review (third community kind, provenance chip), status/pump processing model.
   Cite real file paths.
3. **Edge-case catalog** (the honest section — enumerate with behavior):
   backgrounding/lock (iOS stale-frame hazard + session segmentation), GPS dropout +
   accuracy gating, parallel streets + junction buffers, clock sync + nudge, cost breaker
   + cost_paused + kill switch, detail:low billing regression guard, refusals/incomplete,
   iOS memory limits on video files, OPFS eviction reality, duplicate/blurry frames,
   off-network tracks, oversized sessions, honeypot + rate limits, shared-Supabase
   constraints, public-read bucket tradeoff (capability paths; faces/plates caveat +
   roadmap note for signed URLs), Vercel plan notes (Hobby: pump-on-poll + daily sweep;
   Pro unlocks per-minute cron).
4. **Cost model table**: real numbers from the u29 evidence (live smoke token counts),
   $/session at 150 and 400 frames, escalation overhead.
5. **Ops runbook**: env vars (full table incl. kill switch), applying migrations, bucket
   provisioning, rotating the OpenAI key, monitoring cost fields, clearing stuck jobs,
   pausing extraction.
6. **README.md**: short funnel section linking to the doc.
7. Verify i18n parity still holds (node -e length check on message catalogs) and note it.

## Verification bar
Docs build nothing, so the bar is: every file path cited exists; every env var documented
matches code; mermaid renders (paste into a mermaid CLI or eyeball syntax); lint/build
still green (no code touched); evidence (the checks above) under `.planning/evidence/u31/`.
