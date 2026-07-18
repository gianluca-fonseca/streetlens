# Keyframe extraction: from a camera feed to a few good frames

A capture walk produces a continuous stream of camera frames. The pipeline only
wants a small set of them: distinct, sharp, well-placed JPEGs, each worth the
cost of a vision call. Keyframe extraction is the on-device stage that does the
choosing. This page explains how, and why it is careful about what it keeps. For
the code-level reference inside the funnel, see
[cv-funnel.md](cv-funnel.md#capture-engine-live-recording); the engine lives in
`components/capture/engine/` and `components/capture/hooks/`, with shared
contracts in `lib/capture/`.

The one rule that governs everything else: **raw video never leaves the phone.**
Only the selected JPEGs and a GPS track are uploaded. Selection happens entirely
on device.

## Why be picky

Every kept frame costs a vision-model call and, later, has to be placeable on the
street network by the [map matcher](map-matching.md). So extraction biases toward
frames that are sharp, distinct from each other, and spread out along the walk. A
session is capped at **400 frames** and each frame at **2 MB**
(`CAPTURE_LIMITS`, `lib/capture/types.ts:282`). The cost of that bias is that
brief moments, like a crossing you pass through in a second, are under-represented
(a banked crossing-detection feature is meant to recover those from the GPS track
later).

## The live path

While you walk, the engine runs a clock and a stack of gates. The thresholds all
live in one place, `CAPTURE_TUNING` in `components/capture/engine/tuning.ts`.

### A frame clock that respects visibility

`useFrameClock.ts` fires one callback per decoded camera frame using
`requestVideoFrameCallback`, falling back to `requestAnimationFrame` with a
`currentTime` guard so the same frame is never handed to the gates twice. The
callback only runs when the page is actually visible. This defends a real iOS
hazard: a backgrounded video keeps redelivering its last decoded frame, which
would pin a stale but real-looking image to wherever your GPS is now. That is
fabricated data, and the engine records nothing rather than record it. Frames are
stamped in wall-clock time, not media time.

### The gate order

`gating.ts` runs the cheap checks before it pays for any pixels. The order is
`no_fix -> cadence -> displacement -> duplicate -> blurry`. Only a frame that has
already cleared cadence and displacement gets its pixels read into a small
grayscale thumbnail, so at roughly 30 fps the ~29 rejected frames per second cost
almost nothing.

- **Cadence.** At most one kept frame per second (`minIntervalMs = 1000`).
- **Displacement.** No GPS movement means no frame. A curbside pause simply
  leaves a gap (`minDisplacementM = 6`, meters since the last kept frame).
- **Duplicate.** Two frames are duplicates when the mean absolute difference
  over a 32x32 gray thumbnail falls below `duplicateDelta = 2`. Note this is
  deliberately **not** a perceptual hash: a plain difference cannot false-positive
  the way a hash-bucket collision can. The comparison is against the last frame
  that reached the gates, so it catches both "moved 6 m to an identical wall" and
  iOS hidden-video redelivery (`frame-analysis.ts`).
- **Blur.** A frame below a variance-of-Laplacian floor (`blurVariance = 40`) is
  culled, so head swivels and quick turns drop out on device. This floor is
  marked uncalibrated in the code, a known tuning task.

Other tuning knobs worth naming: `graySize = 32` (the thumbnail edge used for
both dedupe and blur), `accuracyWarnM = 25` (GPS accuracy worse than this raises
a UI warning), `jpegQuality = 0.7` and `maxLongestSide = 1024` (the stored frame
is re-encoded to a 1024 px longest edge), and `maxDurationMs = 1800000` (a
30-minute auto-stop). Frames are downscaled again to a smaller edge at extraction
time before they reach the model; that second downscale belongs to the
[extraction stage](cv-funnel.md#extraction).

### Surviving a killed tab

iOS can discard a backgrounded tab's memory without warning, so nothing is held
in memory waiting for the walk to end. `opfs.ts` is **write-through**: every kept
frame and the updated manifest are written to the Origin Private File System the
instant they exist, so a crash loses at most the single frame in flight. OPFS
support is probed by feature, not by browser sniffing, and falls back to an
in-memory store marked non-durable when it is unavailable (private browsing).

`useRecorder.ts` listens for backgrounding on both `visibilitychange` and
`pagehide` (iOS tab-switch does not always fire the first). On hide it closes the
current segment, flushes the manifest to OPFS, and stops the camera so the OS
recording indicator is not left lit. On resume it clears the gate memory so the
first frame back is kept rather than measured against a minutes-old position.
`useWakeLock.ts` re-acquires the screen lock on every visibility change, because
the browser drops it on hide.

### Upload happens directly, and only for registered frames

`lib/capture/upload-client.ts` uploads the selected JPEGs straight to Supabase
Storage (the `streetlens-frames` bucket), never routing the bytes through a
serverless function. Bytes are only admitted for a frame the client has already
registered, and finalizing the session is the one-way door that enqueues
extraction. The upload and security details are in
[cv-funnel.md](cv-funnel.md#upload-direct-to-storage-armed-by-registration).

## The video-upload path

A contributor can also upload a video they already shot. It becomes the same
frames-plus-track artifact, still decoded entirely on device.

- **Two decoders, one output.** WebCodecs is the fast path (`video-extract.ts`);
  a plain `<video>` element seek loop is the fallback (`video-seek.ts`). Both
  encode through the same `frame-encode.ts`, so which decoder ran is invisible
  downstream. WebCodecs can even fail over to the seek path mid-extraction.
- **Streaming demux.** `video-demux.ts` slices the file in 4 MB chunks, so peak
  memory is one chunk whether the file is 40 MB or 4 GB. This is not optional on
  iOS, where reading a multi-hundred-megabyte file into memory at once kills
  Safari with no catchable error.
- **Rotation and frame order** are handled so WebCodecs output matches the seek
  path: the rotation matrix from the file is applied at encode time, and a
  16-frame reorder window absorbs out-of-order B-frames.
- **No gating here.** Unlike the live engine, the upload path keeps blurry frames
  (an uploader cannot re-shoot) and has no live GPS to gate on. It samples at
  1 fps, and stretches the interval when a long video would exceed 400 frames so
  the whole street is covered at a coarser cadence rather than truncated.
- **The route comes separately.** A phone video carries no GPS track, so the
  contributor imports a GPX file or traces the route on the map.
  `lib/capture/gpx.ts` parses GPX with a strict scanner that rejects the whole
  file on any malformed vertex, and `lib/capture/route.ts` timestamps the route
  so frames can be placed on it by time, the same way the live track is.

## Where to read next

- [map-matching.md](map-matching.md) for how these frames and the GPS track get
  pinned to exact street segments.
- [cv-funnel.md](cv-funnel.md) for the full funnel: extraction, scoring,
  synthesis, human review, and the ops runbook.
