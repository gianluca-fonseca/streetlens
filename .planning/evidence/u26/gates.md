# u26 gate results

Run: 2026-07-17T02:10:57Z
Commit: 8154a35

- tsc --noEmit: PASS
- eslint: PASS
- next build: PASS
- test-matching-hmm.mjs: PASS (37 checks, 0 failures)
- test-matching-baseline.mjs (u25 contract, untouched): PASS (34 checks)

## Key evidence: the HMM earns its keep

Identical track down esc-sa-0451 (parallel street esc-sa-0196 is 12.4-17.8 m away):

  [ok ] the HMM stays on the street walked and never flips to the parallel one — got ["esc-sa-0451"]
  [ok ] the HMM does not shatter the pass into multiple traversals — got 1

  [ok ] the naive baseline DOES flip onto the parallel street (proves the fixture is hard) — baseline got ["esc-sa-0196","esc-sa-0450","esc-sa-0451","esc-sa-0450","esc-sa-0451","esc-sa-0196","esc-sa-0451","esc-sa-0196","esc-sa-0451","esc-sa-0196","esc-sa-0451","esc-sa-0196","esc-sa-0276","esc-sa-0451"]
