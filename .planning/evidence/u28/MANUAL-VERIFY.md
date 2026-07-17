# u28 video upload intake: what a real phone has to tell us

Everything in this file is here because a headless Chromium on a Mac cannot
answer it. The automated drive proves the flow is wired together and that the
plumbing survives a synthetic video. It does not prove any of the things below,
and the honest position until someone runs these is that they are UNVERIFIED,
not that they work.

The items are ordered by how badly they hurt if they are wrong.

## What the automated drive can and cannot reach (measured, not assumed)

Probed directly against Playwright's Chromium 141 on this machine, over
localhost so that the secure-context gate is satisfied:

| Capability | Result |
| --- | --- |
| `isSecureContext` on localhost | true |
| `VideoDecoder` / `VideoEncoder` present | true |
| **H.264 decode (`avc1.42001E`)** | **false** |
| VP8 / VP9 decode | true |
| `MediaRecorder` `video/mp4;codecs=avc1` | **false** |
| `MediaRecorder` `video/webm;codecs=vp8` | true |
| OPFS | true |

Two consequences, and they are the reason items 1 and 2 below exist at all:

1. **Playwright's Chromium cannot decode H.264 at all**, so it can never take the
   WebCodecs path for a real phone video. `canDecodeWithWebCodecs` correctly
   returns false there.
2. `MediaRecorder` here can only produce **VP8 in WebM**, and mp4box cannot demux
   WebM. So a MediaRecorder file goes `probeVideo` fails -> `probeVideoElement`
   -> **seek fallback**.

### CORRECTION (superseded in part by `scripts/verify-u28-video.mjs`)

This section used to conclude that the WebCodecs path was exercised "not at all"
and that this environment "cannot produce an MP4 either". **Both of those claims
were wrong, and the drive now disproves them**, so they are corrected here rather
than left to contradict `playwright-drive.txt`.

The reasoning missed a route: `MediaRecorder` is not the only encoder available.
`VideoEncoder` encodes **VP9** here, and mp4box can **write** an MP4 as well as
read one. `verify-u28-video.mjs` therefore muxes a VP9-in-MP4 fixture at run time
and drives the real fast path with it, asserting from the screen that WebCodecs
ran and not the fallback. Both decoders are now covered by the automated drive.

What that fixture does **not** cover, and what item 1 below is still the only
cover for:

- **H.264 specifically.** Still undecodable here. Every real iPhone video is
  H.264 or HEVC, and neither has ever been through this code.
- **Progressive MP4s.** mp4box's `addSample` writer emits a *fragmented* file
  (`ftyp + moov(mvex) + a moof/mdat pair per sample`). Phone videos are
  progressive (`ftyp + moov` with populated `stbl` + one big `mdat`), which is a
  different demux path. Measured: on the synthetic fixture `createFile(false)`
  still returns all 300 samples with bytes intact, so **the fixture would not
  have caught the inverted-`keepMdatData` bug of `ddbc59f`**.
  `scripts/test-mp4box-contract.mjs` remains the only cover for that.
- **The rotation matrix**, which a synthetic file writes as identity. See item 8.

So item 1 is still a BLOCKER and is still the only thing standing between us and
a fast path that has never met a real phone stream. Treat it accordingly.

## 1. iOS Safari actually decodes a real phone video (BLOCKER if it fails)

The whole fast path is `VideoDecoder` + mp4box demux. It is written against the
spec and against sealed research, and it has never met a real H.264 stream out of
an iPhone camera.

- [ ] Record ~2 minutes of POV walking on an iPhone. Do not AirDrop it to a Mac
      first: transferring can re-encode and rewrite mtime, and then you are
      testing the transfer, not the phone.
- [ ] Open `/collect` in iOS Safari over https (the page needs a secure context),
      choose "upload a video", pick that file from the camera roll.
- [ ] Frames extract, and the count reaches roughly `duration / 1s`.
- [ ] **Check which path ran.** The UI does not shout about it by design. In the
      console: if the seek fallback ran on an iPhone, that is a finding worth
      reporting even though the flow "worked", because it means
      `canDecodeWithWebCodecs` said no to a stream Safari can obviously decode,
      and everyone on iOS is silently taking the slow path.
- [ ] Zero console errors across the whole flow.

## 2. Frame ordering on iOS below 26.4 (silent data corruption if wrong)

iOS below 26.4 can emit H.264 B-frames out of presentation order. The reorder
buffer in `video-extract.ts` exists for exactly this and has never been observed
doing its job, because the Mac's decoder does not reproduce the bug.

- [ ] On an iPhone running iOS < 26.4 if you can find one, extract from a video
      with B-frames (any normal camera recording).
- [ ] The extracted frames, viewed in seq order, must move FORWARD along the
      street monotonically. A frame that jumps backwards and then forwards again
      is the reorder buffer failing, and it is invisible in every count and every
      progress bar. This is the failure mode that would quietly poison the
      dataset while every number on screen looks right.

## 3. Memory on a large file (tab death if wrong)

`File.arrayBuffer()` is never called; the file is sliced 4 MB at a time. That is
the single most important design decision in the unit and the one most likely to
have a hole in it (mp4box retention, decoder queue, blobs held before the OPFS
write).

- [ ] A **500 MB+** real video. 10 to 20 minutes of 1080p is the realistic case.
- [ ] The tab must not die. If it dies, note the file size and where in the
      progress it died.
- [ ] Watch memory in Safari's Web Inspector (Timelines > JavaScript Allocations)
      or Chrome's Task Manager. Peak should stay in the tens of MB and stay FLAT.
      A slope that tracks the progress bar means something is retaining, and
      `releaseUsedSamples` or the decode-queue throttle is not doing its job.
- [ ] Repeat on Android Chrome.

## 4. Extraction resumes after a tab kill

The checkpoint is written to OPFS after every frame. This is testable on a Mac in
principle, but it is worth doing on the phone where the kill is real.

- [ ] Start extracting a long video. Around halfway, force-quit Safari.
- [ ] Reopen `/collect`. The session should be recoverable and extraction should
      resume near where it stopped rather than restarting at zero.
- [ ] **The live recorder must NOT offer this video session as an unfinished
      walk.** (This is the bug fixed in `d7f25c7`; the manifests share a store.)
      Check both entry points: choosing "record live" after a killed video
      extraction must show the normal start screen, not a recovery prompt.

## 5. OPFS on iOS Safari

`isOpfsSupported()` probes for `createWritable`, which Safari got on the main
thread much later than it got OPFS in workers.

- [ ] On iOS Safari, confirm the flow does not show the "cannot save to disk"
      warning. If it does, extraction still works but nothing survives a reload,
      and the resume test above is moot on that device.

## 6. The seek fallback, on something that needs it

- [ ] Find a container WebCodecs will not take but `<video>` will play. A `.webm`
      is the easy case (mp4box cannot parse it at all, so the element probe runs).
- [ ] Frames still extract. They will be slower and less exact, which is fine.
- [ ] `SETTLE_MS = 100` in `video-seek.ts` is a guess from research, not a
      measurement. If extracted frames look like they lag the target time by one
      frame, that value is too low and this is the only way to find out.
- [ ] The stuck-frame detector aborts after 3 identical frames. Walk a genuinely
      static scene (stand still for 10 s mid-video at a stretched interval) and
      confirm it does NOT abort a legitimate extraction. If it does, the
      threshold is wrong.

## 7. The clock, and the one place it matters

The nudge only appears on a timed GPX, deliberately (see the escalation in the
control file: it is a provable no-op elsewhere). What has never been checked is
whether the derived start is even in the right ballpark.

- [ ] `deriveVideoStartMs` assumes the file's mtime is the recording END. Confirm
      against a video whose real start time you know.
- [ ] **Timezone.** Phones write local time into a field the spec says is UTC.
      If the derived start is out by exactly a whole number of hours, that is
      this bug, and a ±60 s slider cannot reach it. That would be a real design
      gap to report, not a tuning problem.
- [ ] With a timed GPX from a watch: nudge the slider and confirm the frame
      preview visibly moves along the route. This is the only configuration where
      it does anything at all.

## 8. Sanity on the data, not just the flow

- [ ] Pick 3 extracted frames at random and confirm they show the STREET, facing
      forward, and are not upside down or rotated 90 degrees. Phone videos carry
      a rotation matrix in the container, and nothing in this unit reads it.
      **If frames come out sideways, that is a real bug and it is not covered by
      any test we have.**
- [ ] Confirm a frame's `t` places it where it actually was: cross-check one
      frame's landmark against the route position the map shows for it.

## 9. Desktop

- [ ] Drag and drop a file onto the drop target in Chrome and Safari on a Mac.
- [ ] The trace map: draw a route, toggle follow-streets, undo, clear. Confirm
      the routed line follows streets and that a point dropped off-network draws
      the dashed fallback and raises the honest "this stretch is a guess" notice.

---

**Reporting.** Anything that fails here belongs in the run record as a defect
with the device and OS version attached, not as a tuning note. Items 2, 3 and 8
are the ones that can be wrong while every number on the screen looks right,
which makes them the ones worth the most attention.
