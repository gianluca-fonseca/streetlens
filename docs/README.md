# StreetLens documentation

The [root README](../README.md) is the three-minute tour: what StreetLens is,
the four lenses, how data gets in, and how to run it. This folder is where the
tour goes deep. Each page stands on its own, and each is verified against the
code it describes.

## Start here

- **[method.md](method.md)** — The scoring model. The four lenses, rubric v0.1
  and its 15 items, the 0-to-100 scale and legend bins, the sealed color and
  width encoding, and the Ley 7600 accessibility minimums. Read this to
  understand what every number on the map means.
- **[architecture.md](architecture.md)** — How the app is built. Routing, the
  frozen data adapter (`lib/segments.ts`), the MapLibre map layer, the static
  render pipeline, the contribution flow, and the planned Supabase schema. Read
  this to find where a thing lives in the code.

## Go deeper: the CV data-collection funnel

A contributor can film a street and have a vision model pre-score the frames
against the same rubric a human auditor uses. The output is a proposal that a
person still approves before anything reaches the map. Three pages cover it,
from the whole pipeline down to its two hardest on-device stages.

- **[cv-funnel.md](cv-funnel.md)** — The full reference: why the funnel exists,
  what one frame becomes, confidence and cost, the baseline-and-synthesis
  scoring, the human review layer, the security model, the edge-case catalog,
  and the ops runbook. Start with
  [How the model works, end to end](cv-funnel.md#how-the-model-works-end-to-end).
- **[keyframe-extraction.md](keyframe-extraction.md)** — How a continuous camera
  feed (or an uploaded video) becomes the small set of sharp, well-placed JPEGs
  that enter the pipeline. The live gates, crash-safe storage, the video-decode
  path, and why raw video never leaves the phone.
- **[map-matching.md](map-matching.md)** — How each frame is pinned to an exact
  street segment from a noisy GPS track. The Newson-Krumm Hidden Markov Model,
  its parameters, and why it holds where naive nearest-segment snapping flips
  between parallel streets.

## Reference

- **[design-direction.md](design-direction.md)** — The visual language: the zen
  instrument look, type, color discipline, and the sealed map encoding as a
  design contract.

## A reader's path

If you are new, read the [root README](../README.md), then
[method.md](method.md) for the scoring model and
[architecture.md](architecture.md) for the build. If you care about the
computer-vision path, read [cv-funnel.md](cv-funnel.md) top to bottom, and reach
for [keyframe-extraction.md](keyframe-extraction.md) and
[map-matching.md](map-matching.md) when you want the two on-device stages in
full.
