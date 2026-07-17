# Test fixtures

## street-san-antonio-escazu.jpg

A real street scene from **San Antonio de Escazú** — the pilot area itself,
which is why this one was picked over a generic street photo: it is the kind of
frame the extractor will actually see.

- **Source:** [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Street_Photography_Costa_Rica_town_store_or_pulperia_San_Antonio_Escazu_1970s.jpg)
- **Author:** Julián Monge-Nájera
- **License:** CC BY-SA 4.0
- **Fetched:** 2026-07-16, resized to 960 px wide (167 KB, 960x666, baseline JPEG)

Used only by `scripts/live-smoke-extraction.mjs`, which is env-gated behind
`RUN_LIVE_SMOKE=1` and makes exactly one real model call. It is committed rather
than downloaded at test time so the smoke does not depend on Wikimedia being up,
and so the bytes the model saw are the bytes in the repo.

The photo dates from the 1970s. That does not matter for what the smoke asserts
(that a real response parses against the strict schema, and that `detail: "low"`
was actually honoured in the billed token count). It is not a rubric ground
truth and nothing asserts the model's *answers* are correct.
