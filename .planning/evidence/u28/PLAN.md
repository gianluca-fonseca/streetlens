# u28 — video upload intake: plan

Validated the Conductor seed against the worktree. It holds. Two findings that
change nothing but are worth stating, because they are what the plan rests on:

1. **The wire contract already admits this whole feature.** `lib/capture/types.ts`
   already has `TrackSource = "live" | "gpx" | "trace"` and
   `CaptureSessionMode = "live" | "video"`; `lib/capture/schemas.ts` validates
   both, and the finalize route already reads `source` + `clockOffsetMs` and runs
   `validateTrack(track, source)` (which deliberately exempts gpx/trace from the
   live fix-count and duration floors). So this unit adds **no server code and no
   contract change**. Client only.
2. **`mp4box@2.4.1` is already a dependency.** No new runtime dep is needed for
   demux. (`sharp` is server-side extraction, unrelated.)

## What exists that I extend, not rebuild

- `/collect` → `CollectClient.tsx` (`ssr:false` boundary, mandatory: Next 16
  forbids `ssr:false` in a Server Component) → `LiveRecorder`.
- Reusable as-is: `lib/capture/upload-client.ts` (`uploadCapture`), OPFS
  `CaptureStore` (`engine/opfs.ts`), `engine/frame-analysis.ts`
  (`fitDimensions`/`toGray`/`laplacianVariance`), `engine/tuning.ts`,
  `engine/geo.ts` (haversine), `TrackMiniMap`, `components/capture/ui.tsx`.
- Reusable with care: `components/contribute/routing.ts` (`getRouter`,
  module-memoized) and `routing-core.mjs` (`createRouter`, pure) for
  follow-streets. `useContribute` is coupled to `/api/submissions` and forces
  `mode="add"` on finish, so I lift the drawing engine rather than mount it.

## Layers (one atomic commit each)

**L1 — pure route math (node-testable, no DOM).**
- `lib/capture/gpx.ts`: `parseGpx(xml)` → trkpts (lat/lon/ele/time).
  Hand-rolled scanner, NOT `DOMParser`: the repo's test harness compiles TS to
  CJS and runs it in bare Node, where `DOMParser` does not exist. GPX trkpt is
  regular enough to scan honestly.
- `lib/capture/route.ts`: `pathLengthMeters`, `distributeTimesAlongPath`.
  The inversion that matters: for a route with no timestamps I do NOT distribute
  frames along the path. I assign each **path vertex** a time proportional to its
  cumulative distance across `[videoStart, videoEnd]`, producing a real
  `TrackPoint[]`. `interpolateAt` then places frames for free, and the
  constant-pace assumption lives in one documented place.
- Test: `scripts/test-capture-route.mjs` (GPX with + without times, distribution
  math), house style — bare node, `check()`, exit code.

**L2 — extraction engine (browser).**
- `engine/video-demux.ts`: mp4box.js fed by `Blob.slice` + `appendBuffer`.
  NEVER `File.arrayBuffer()` (iOS kills the tab ~100-200 MB, uncatchable).
- `engine/video-extract.ts`: `VideoDecoder`, ~1 fps at mid-second offsets.
  **Sort by `frame.timestamp`** before sampling (iOS <26.4 emits H.264 B-frames
  out of order). `close()` every `VideoFrame` in `finally` (GPU memory).
  JPEG straight to OPFS via the existing store; reuse `fitDimensions(…, 1024)` +
  `toBlob("image/jpeg", 0.7)` and `laplacianVariance` for `blurScore`, so an
  uploaded frame is byte-identical in treatment to a live one.
- `engine/video-seek.ts`: fallback behind `VideoDecoder.isConfigSupported()`
  failure. `<video>` + serial seeks, `preload="metadata"`, ~100 ms settle after
  `seeked`, stuck-frame detection by gray hash compare.
- `engine/video-session.ts`: manifest + OPFS checkpoint so a tab kill resumes.
- Caps: `CAPTURE_LIMITS.maxFrames` (400). A long video samples **sparser** to
  fit, and the UI says so out loud rather than silently truncating.
- Gating note: `evaluateFrame` is GPS-driven (`no_fix` gate) and does not apply
  here; the route does not exist yet at extraction time. Video frames use a
  separate composition reusing only `frameDelta` + `laplacianVariance`.

**L3 — hook.** `hooks/useVideoUpload.ts`: phase machine
`idle → extracting → route → review → uploading → done`, plus `unsupported`
and `recover`.

**L4 — screens** (`screens/video/`): pick (drag-drop, desktop-friendly),
extracting (progress), route (GPX file OR trace map), clock nudge (±60 s slider
with live frame-thumbnail vs route-position preview) feeding `clockOffsetMs`,
review → `uploadCapture({ mode: "video", source })`.

**L5 — /collect mode chooser** (live vs upload). Manual contribution flow
untouched.

**L6 — i18n EN + ES** parity, extending the `collect` namespace. Voseo, no em
dashes, identical key tree/order.

## Sealed-design constraints I am bound by

Radii 2/4/6 only. Pink is signal-only (CTA / active / LIVE dot), never a wash or
border or body text. **Glass only over live map tiles** — a `<video>` preview of
an uploaded file is not tiles, so it gets `Plate` + hairline. Serif never in a
headline. Zero emoji. Copy is declarative/imperative, no em dashes.

## Honest risks

- **No auto-geolocation, ever.** Phone videos carry at most one start fix and
  browsers strip it on file input. The route step is mandatory. A parseable
  QuickTime `©xyz` start fix is used ONLY to center the trace map.
- WebCodecs on iOS Safari and real large-file memory behaviour cannot be proven
  in headless Chromium. That goes to `MANUAL-VERIFY.md` as a real-device
  checklist rather than being claimed as passed.

## Verification bar

tsc + lint + build green; zero console errors on the driven flow. Node test for
GPX + distribution. Playwright drive (synthesize a canvas→MediaRecorder video
in-browser) of upload → extract → trace → finalize against mocked routes,
asserting frame count + manifest; 390 px + desktop screenshots, EN + ES.
Evidence under `.planning/evidence/u28/`.
