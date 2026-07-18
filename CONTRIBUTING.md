# Contributing to StreetLens

Thanks for helping measure streets. Contributions are welcome across code, translations, rubric review, and (once the pilot opens) field audits. This guide covers setup, the gates to run before you push, the commit and i18n conventions, and the honesty rules everyone keeps.

For the wider picture, see the [README](README.md), the [method](docs/method.md), and the [architecture](docs/architecture.md).

## Setup

```bash
git clone https://github.com/gianluca-fonseca/streetlens.git
cd streetlens
npm install
npm run dev
```

The app runs at <http://localhost:3000> with **no environment variables**: it serves demo data over real OpenStreetMap geometry through the data adapter. You can build every UI path, including the map, without a database.

Optional configuration, documented by **name only** (never commit a secret value):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Point the adapter at a Supabase project instead of the static demo files. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key for that project. |
| `ADMIN_PASSWORD` | Shared password for the admin login. |
| `ADMIN_RPC_SECRET` | Secret the admin RPCs check inside Supabase. |
| `SUBMISSIONS_IP_SALT` | Salt for hashing submitter IPs in the contribute flow. |

Put these in `.env.local` (gitignored). Copy `.env.local.example` for the full variable list with placeholders. Do not paste real values into issues, PRs, commits, or docs.

## Gates

Run all four before you push. CI on `main` and `next` runs the same checks.

```bash
npx tsc --noEmit     # types
npm run lint         # eslint (eslint-config-next)
npm test             # all scripts/test-*.mjs contract suites
npm run build        # production build must pass
```

`npm test` runs every `scripts/test-*.mjs` suite serially and prints a summary. Tests use isolated temp data stores (`STREETLENS_DATA_DIR`) so they do not touch your real `data/*.local.json` files. The migration suite (`test-capture-migrations.mjs`) requires Docker; it skips with a warning locally but **fails in CI** when Docker is unavailable.

Also run `node scripts/test-i18n-parity.mjs` if you change message keys (included in `npm test`).

If you change the sealed map config (`components/mapConfig.ts` ramps, bins, width, or basemap), also regenerate the static plates so the landing art stays in sync:

```bash
npm run render:maps
```

## Commit style

- **Conventional commits**: `type(scope): summary`, for example `fix(map): clamp camera to terrain` or `docs(method): document rubric v0.1`.
- **Atomic and focused.** One logical change per commit. Stage with explicit pathspecs (`git add path/to/file`), never `git add -A`, so each commit contains only what it means to.
- **Never push to `main` directly.** Branch (`fix/*`, `feat/*`, `docs/*`), open a PR, and let review run.
- Keep prose in commit bodies free of em dashes (see below).

## Internationalization parity

StreetLens ships English and Spanish (`es-CR`) at parity. The rule is strict:

- `messages/en.json` and `messages/es.json` must have the **same key structure**. If you add a key to one, add it to the other in the same place.
- **Arrays must be equal length** across locales, since the UI maps over them positionally.
- Spanish keeps the **parallel, imperative cadence**, not a literal word-for-word translation. Match the register, not the syntax.
- English is the canonical source; Spanish follows es-CR conventions.

A missing or mismatched key should fail review. When in doubt, translate meaning and rhythm.

## Honesty rules

These are not style preferences. They are what makes StreetLens trustworthy, and every contribution keeps them.

- **Demo data is always labeled.** Anything shown before the August 2026 pilot is demo data over real geometry. Never present a demo number as a real measurement, and never remove a demo caveat.
- **Scores publish with their formula.** A score is a rubric of observed items, higher is better, with visible value bins. Do not add a score you cannot explain.
- **No fabricated metrics, users, cities, or impact.** No invented adoption, no fake testimonials, no "we improved N streets." Aspiration is fine as principle, never as a data claim.
- **Machine learning proposes; humans approve.** Vision models may propose readings and synthesis text for the CV funnel (see [docs/cv-funnel.md](docs/cv-funnel.md)), but a human admin must approve every observation before it lands on the public map. Never claim published map scores are model output, and never add an "AI-powered" badge.
- **Community contributions are unverified until audited.** Resident-added segments carry no score and render in the neutral casing.
- **The sealed data layer is off-limits.** The ramps, bins, width channel, and basemap semantics in `mapConfig.ts` (and their mirror in the render script) are sealed. Do not recolor or rescale them without an explicit design ruling.
- **No secrets.** Environment variables are referenced by name only. Scan your diff before committing.
- **No em dashes in new prose.** House rule across copy, docs, comments, and commit messages. Re-cadence with periods, colons, semicolons, or parentheses as the grammar calls for.

## Requesting a city

StreetLens is built so Escazú is the pilot, not the boundary. To ask for your city, [open an issue](https://github.com/gianluca-fonseca/streetlens/issues/new?title=City%20request:%20) with the canton or municipality and, if you can, a link to its OpenStreetMap coverage.
