# Test fixtures

## street-real.jpg

A real street-level photograph of a rural/suburban road: a paved single-track
lane with grass verges (shoulders) on both sides, hedgerow edges, a utility
pole, and a cluster of houses in the distance. This is an honest street scene,
so the extraction model has something real to score (road surface, edges, and a
shoulder situation), unlike `street-san-antonio-escazu.jpg` below, which is the
inside of a shop and was never a street.

- **Source:** [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Hurst_Lane_takes_on_a_Hard_Surface_-_geograph.org.uk_-_7863103.jpg) (originally [Geograph Britain and Ireland](https://www.geograph.org.uk/photo/7863103))
- **Author:** Chris Heaton
- **License:** CC BY-SA 2.0 (https://creativecommons.org/licenses/by-sa/2.0)
- **Credit:** Geograph Britain and Ireland
- **Fetched:** 2026-07-17, downscaled to 960 px wide (136 KB, 960x640, baseline JPEG)

Used by `scripts/live-smoke-extraction.mjs` (env-gated behind `RUN_LIVE_SMOKE=1`)
when pointed at it via `SMOKE_FIXTURE=scripts/fixtures/street-real.jpg`. It is
committed rather than downloaded at test time so the smoke does not depend on
Wikimedia being up, and so the bytes the model saw are the bytes in the repo.
The frame is downscaled to `FRAME_MAX_EDGE_PX` before the call, exactly as a
real frame is.

## street-san-antonio-escazu.jpg

A real photograph from **San Antonio de Escazú**, the pilot area itself.

**IT IS NOT A STREET.** It is the inside of a pulpería: shelves, hanging bags,
a shopkeeper. The file was picked off a Wikimedia title beginning "Street
Photography …", which is the genre, not the subject — the same title says "town
store or pulperia" further along. Measured on 2026-07-16, gpt-5-nano answers
`usable: false, reason: no_street_visible` with every item null, at the
extraction downscale and at full resolution alike. That is the model being
RIGHT, and the smoke passes because it asserts plumbing, not answers.

So: this fixture evidences that a real call is shaped correctly, is billed what
we expect, and parses against the strict schema. It evidences NOTHING about
whether the model can read a street, because it has never been shown one. A
fixture that is actually a residential street is what the rubric needs, and
picking one is a judgement about ground truth that should be made deliberately
rather than by title-match.

- **Source:** [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Street_Photography_Costa_Rica_town_store_or_pulperia_San_Antonio_Escazu_1970s.jpg)
- **Author:** Julián Monge-Nájera
- **License:** CC BY-SA 4.0
- **Fetched:** 2026-07-16, resized to 960 px wide (167 KB, 960x666, baseline JPEG)

Used only by `scripts/live-smoke-extraction.mjs`, which is env-gated behind
`RUN_LIVE_SMOKE=1` and makes exactly one real model call. It is committed rather
than downloaded at test time so the smoke does not depend on Wikimedia being up,
and so the bytes the model saw are the bytes in the repo.

The photo dates from the 1970s. That does not matter for what the smoke asserts
(that a real response parses against the strict schema, and that the frame is
billed inside its token ceiling after being downscaled). It is not a rubric
ground truth and nothing asserts the model's *answers* are correct.

## extraction-eval.json

Labeled fixture set for `scripts/eval-extraction.mjs` / `npm run eval:extraction`.
Each entry names a committed image and the human-visible expectations
(`usable`, `sidewalk_present`, …). Operator-run only — it bills OpenAI tokens
and is **not** wired into `npm test`. Do not point this harness at the live DB;
merge additional local labels via `EVAL_LABELS=…` when you have reviewer-override
frames on disk.
