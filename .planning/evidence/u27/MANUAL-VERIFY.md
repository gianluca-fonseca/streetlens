# u27 live recorder — manual verification

The recorder is driven end to end by `scripts/verify-u27-recorder.mjs` in a real
Chromium with a fake camera and a scripted GPS walk. That proves the logic. It
does not prove the physics, and this page is mostly physics: a real sensor, a
real radio, a real battery, and an OS that is actively trying to suspend you.

This file is the honest click-through of what a desk cannot answer. No fabricated
screenshots; everything below is unproven until someone walks it.

## Preconditions

- A real phone. iPhone with Safari is the priority target, since it is both the
  most common device in Escazú and the most hostile runtime here.
- **HTTPS.** `getUserMedia` is refused on plain http, and the LAN dev server is
  http. Use a tunnel (`ngrok http 3000` or similar) or a deployed preview.
  Opening `http://<lan-ip>:3000/en/collect` will correctly show the
  "cannot record here" screen, which is itself worth seeing once.
- Somewhere with sky. GPS indoors will sit on `no_fix` and keep nothing, by design.

## What to click and expect

### 1. Start screen and permissions
- `/en/collect` shows the explainer BEFORE any prompt fires. No camera or
  location dialog should appear on load.
- Tap "Start recording". Both prompts appear only now. iOS requires the gesture,
  and this is the one flow a desk browser cannot honestly simulate.
- Deny the camera. Expect "Camera access was refused" in place, not a toast, and
  the start screen still usable. Re-allow via site settings and retry.

### 2. The rear camera is actually the rear camera
- **The single most important check here.** The preview must show the world, not
  your face. The code asks for `facingMode: {exact: "environment"}` and falls back
  to the non-exact form on `OverconstrainedError`; if a device takes the fallback
  and still hands over the selfie camera, that is a real defect worth a bug.

### 3. Walk it
- Walk ~100 m at a normal pace. Expect frames to climb roughly once a second and
  every six metres, whichever is slower. Standing still must NOT bank frames:
  watch "Frames" stop climbing while "Elapsed" keeps going.
- Distance should track reality within GPS error. If it reads wildly long while
  standing still, the fixes are jittering and the displacement gate is the only
  thing protecting the dataset.
- Point the phone at a blank wall while walking: frames should stop being kept and
  the review screen should later attribute them to "Same picture as the frame
  before" or "Too blurry to score".

### 4. Wake lock (cannot be tested on desk)
- Screen must stay on for the whole walk without touching it. The verification run
  shows "Your screen may sleep" because headless Chromium has no wake lock; on a
  real phone that warning must be ABSENT.
- Enable iOS Low Power Mode and start again. Expect the lock to be refused and the
  warning to appear. The walk must still record.

### 5. Backgrounding (cannot be tested on desk)
- Mid-walk, switch to another app for ~15 seconds, then come back.
- Expect: recording stopped, "Recording stopped" panel, everything so far intact.
- Tap "Resume recording", keep walking, then stop. The walk should have TWO
  segments in its manifest and no frames from the backgrounded stretch.
- **The thing to watch for:** any frame timestamped during the gap. iOS
  re-delivers the last decoded frame from a hidden video, and the visibility gate
  exists to refuse it. A frame from the pocket would be fabricated data.
- Repeat with a lock-screen press rather than an app switch (`pagehide` path).

### 6. OPFS persistence (cannot be tested on desk)
- Mid-walk, force-quit the browser. Reopen `/collect`.
- Expect "You have a walk that was never uploaded" with a plausible frame count.
- **Safari specifically:** OPFS support is probed via `createWritable`, which
  Safari gained late. If Safari falls back, the start screen shows "This browser
  cannot save frames to disk" and a reload loses the walk. Confirm which branch a
  real iPhone takes. This is the largest single unknown in the unit.

### 7. Upload
- Today this correctly ends at "Uploads are not switched on yet": the
  `/api/capture/*` routes are 501 stubs until the ingest unit lands. The frames
  must stay on the device and "Retry upload" must be offered.
- Once ingest is live, re-run and confirm a real session lands, and that
  force-quitting mid-upload then retrying resumes rather than duplicating.
- Turn on airplane mode mid-upload. Expect "No connection", frames safe, retry.

### 8. Thermals and battery
- Walk the full 30 minutes or 400 frames to the cap. Expect a graceful auto-stop
  at review, naming the cap.
- Watch for the phone getting hot or the preview stuttering. The gates were built
  cheap for this reason (a cadence rejection touches no pixels), but only a real
  30-minute walk on a mid-range Android will tell you.

## Not proven, and known to be unproven

- **The two vision thresholds are estimates.** `duplicateDelta: 2` and
  `blurVariance: 40` (`components/capture/engine/tuning.ts`) were never calibrated
  against real Escazú footage. The synthetic test proves a flat frame scores 0 and
  a checkerboard scores ~1.04M, which brackets the threshold but says nothing
  about a real sidewalk at noon. **Walk once, then read the review screen's
  dropped-frame table:** if "Too blurry to score" dominates a walk that looked
  fine, `blurVariance` is too high. That table exists partly to make this tunable
  from field data instead of from opinion.
- **The storage PUT has never run against a live bucket.** `streetlens-frames`
  does not exist until migration 0013 is applied. The verification run stubs the
  Supabase storage endpoint at the network layer, so the request shape is
  exercised but the bucket's RLS policy is not.
- **Sub-segment handling is proven only in unit tests**, never against a real iOS
  backgrounding.
- Wake lock, OPFS durability and true `facingMode` behaviour are all desk-blind,
  per the sections above.

## Gates (run from the worktree)

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `node scripts/test-capture-gating.mjs`
- `node scripts/test-upload-client.mjs`
- `node scripts/verify-u27-recorder.mjs --base http://localhost:3145`
  (needs `next start -p 3145` and `PLAYWRIGHT_MODULE` pointing at an npx-installed
  playwright; deliberately not a package.json dependency)
