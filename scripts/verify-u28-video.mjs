#!/usr/bin/env node
/**
 * verify-u28-video.mjs (u28 uploaded-video intake)
 *
 * Drives the uploaded-video path end to end in a real Chromium: chooser -> pick a
 * file -> extract the frames -> supply a route -> review -> upload, and writes
 * screenshots plus a verdict.
 *
 * `verify-u27-recorder.mjs`'s sibling, and deliberately the same shape: same
 * `results` list, same console-error collection and filtering, same `--base`,
 * same verdict file. Read that one first; the differences below are the ones
 * that matter.
 *
 * NOT part of the app's dependencies. Playwright is resolved through
 * PLAYWRIGHT_MODULE (or a global install) and stays out of package.json: this is
 * a verification harness for one unit, not a runtime or build concern.
 *
 * ## Where the video comes from, and why it is a WebM
 *
 * There is no video fixture checked in, and there cannot be a useful one. This
 * flow needs a real, decodable file, and a committed binary blob would be a fact
 * nobody can review in a diff. So the video is SYNTHESIZED in the browser at run
 * time: a canvas animation -> `captureStream()` -> `MediaRecorder` -> bytes.
 *
 * That forces the codec, and the choice is not ours. This Chromium cannot decode
 * H.264 at all (`MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")` is
 * false, and `VideoDecoder` refuses avc1), Playwright's bundled ffmpeg is built
 * `--disable-everything` (VP8/WebM only), and there is no system ffmpeg. VP8 in
 * WebM is the only container this machine can produce. See
 * `.planning/evidence/u28/probe-codecs.mjs`, which reproduces all of it.
 *
 * ## Which decoder that exercises, stated plainly
 *
 * `useVideoUpload.probe()` tries `probeVideo` (mp4box demux) first and falls back
 * to `probeVideoElement` + `extractFramesWithSeek` when that fails. mp4box cannot
 * demux WebM, so this drive takes the SEEK path, every time, by construction.
 *
 * The WebCodecs path is therefore NOT exercised here. That is a real gap and it
 * is stated in the verdict rather than papered over: the fast path is covered by
 * `scripts/test-mp4box-contract.mjs` (which pins the one mp4box assumption that
 * already broke it once) and by the real-device checklist in
 * `.planning/evidence/u28/MANUAL-VERIFY.md`, and by nothing else. A synthetic
 * VP9-in-MP4 was attempted to close it; see the verdict file for the outcome.
 *
 * ## The animation is not decoration
 *
 * `extractFramesWithSeek` aborts with `seek_stuck` after 3 consecutive
 * byte-identical thumbnails, which is the right call against a wedged element
 * and would also legitimately kill a drive against a static test pattern. So the
 * canvas animates a moving shape AND a per-frame counter: every sampled second
 * is visibly different, and the detector has nothing to fire on.
 *
 * ## Why GPX rather than the map
 *
 * The route step takes a GPX or a line drawn on `TraceMap`. The map needs tiles
 * from a third party and `/api/routing-network`, so driving it would make this
 * run's verdict depend on the network. The GPX picker is the same `applyRoute`
 * with none of that, so the route is a GPX fixture built in memory here. The map
 * still mounts on the route screen, and its tile fetches are filtered as
 * environmental exactly as u27 filters them.
 *
 * Usage: node scripts/verify-u28-video.mjs [--base http://localhost:3905]
 * Exits 0 on PASS, 1 on any failure.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".planning/evidence/u28");

const baseArg = process.argv.indexOf("--base");
const BASE = baseArg !== -1 ? process.argv[baseArg + 1] : "http://localhost:3905";

// Resolved from wherever npx put it; never from the project's node_modules.
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const results = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  results.push({ label, ok, detail });
}

/**
 * Wait for text and report whether it arrived.
 *
 * NOT `isVisible()`. That method is a synchronous read with no retry, so
 * asserting with it straight after a click races React's next render and fails
 * on a screen that is about to be perfectly correct. Every screen assertion here
 * is a wait with a deadline, so a failure means the screen never came, which is
 * the only thing worth failing on.
 */
async function sawText(page, text, timeout = 15_000) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

/** The negative of `sawText`: settled, then confirmed absent. */
async function absentText(page, text, settleMs = 1_500) {
  await page.waitForTimeout(settleMs);
  return (await page.getByText(text).count()) === 0;
}

const consoleErrors = [];
const notes = [];

/** Escazú, the same stretch the u27 walk uses, so the two drives sit on one map. */
const START = { lat: 9.9187, lng: -84.1408 };

/** Roughly 10 m a point, which is a walking pace at one point a second. */
const GPX_POINTS = 12;
const GPX_STEP_LAT = 0.00009;

/** How long the synthesized video runs. 12 s at 1 fps sampling is 12 frames. */
const VIDEO_MS = 12_000;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * A timed GPX over the same street.
 *
 * Timed on purpose: `hasTimes` is what routes the manifest down the
 * `timedTrack` branch, which is the branch that makes `clockOffsetMs` mean
 * anything at all. An untimed file would take the "spread the duration evenly"
 * branch and the clock assertion downstream would be vacuous.
 *
 * The stamps start at the epoch second the video's own `lastModified` will be
 * near enough to; nothing here depends on them lining up, because the clock
 * offset is a nudge from the file's guess and starts at zero.
 */
function gpxFixture(startMs) {
  const points = [];
  for (let i = 0; i < GPX_POINTS; i += 1) {
    const lat = (START.lat + GPX_STEP_LAT * i).toFixed(6);
    const lng = START.lng.toFixed(6);
    const t = new Date(startMs + i * 1_000).toISOString();
    points.push(`      <trkpt lat="${lat}" lon="${lng}"><ele>1100</ele><time>${t}</time></trkpt>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="verify-u28-video" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <trk>",
    "    <name>u28 synthetic walk</name>",
    "    <trkseg>",
    ...points,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
  ].join("\n");
}

/**
 * Record a canvas animation into a real WebM, in the browser, and hand back the
 * bytes.
 *
 * Done once and reused across every context: this is ~12 s of wall clock and
 * there is nothing per-context about the file.
 */
async function synthesizeVideo(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // A page on the real origin, not about:blank: MediaRecorder is content-bound
  // and the WebCodecs probes in the sibling evidence script need a secure
  // context, so everything here stays on localhost for consistency.
  await page.goto(`${BASE}/en/collect`, { waitUntil: "domcontentloaded" });

  const encoded = await page.evaluate(async (durationMs) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    let n = 0;
    const draw = () => {
      // A scrolling background, a travelling marker and a counter. Any one of
      // the three would defeat the stuck detector; all three make the frames
      // legible in the extracted JPEGs when somebody opens them.
      ctx.fillStyle = "#0f1720";
      ctx.fillRect(0, 0, 640, 480);
      ctx.strokeStyle = "#26323f";
      ctx.lineWidth = 2;
      for (let x = -((n * 4) % 64); x < 640; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 480);
        ctx.stroke();
      }
      ctx.fillStyle = "#ff2e88";
      ctx.beginPath();
      ctx.arc(60 + ((n * 5) % 520), 240 + Math.sin(n / 12) * 120, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 64px monospace";
      ctx.fillText(`F${String(n).padStart(4, "0")}`, 24, 80);
      ctx.font = "24px monospace";
      ctx.fillText(`t=${(n / 30).toFixed(2)}s`, 24, 120);
      n += 1;
    };

    draw();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    const timer = setInterval(draw, 1000 / 30);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    clearInterval(timer);
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });

    const blob = new Blob(chunks, { type: "video/webm" });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return { bytes: Array.from(buffer), type: blob.type };
  }, VIDEO_MS);

  await context.close();
  return Buffer.from(encoded.bytes);
}

/* ------------------------------------------------------------------ *
 * The VP9-in-MP4 fixture, for the fast path
 * ------------------------------------------------------------------ */

/**
 * Build an MP4 with a VP9 track, so the WebCodecs path has something to read.
 *
 * The seek drive above covers one of the two decoders and leaves the other
 * covered by nothing, which is how a demux bug hid here once already:
 * `createFile`'s `keepMdatData` is inverted internally, the wrong value extracts
 * ZERO samples and mp4box says so only at warn level, and every count downstream
 * stayed truthfully zero. See `ddbc59f` and `scripts/test-mp4box-contract.mjs`.
 *
 * There is no H.264 to be had (this Chromium will not decode it and there is no
 * ffmpeg) and no `VideoEncoder` in Node, so this is split: encode VP9 in the
 * browser, mux in Node with mp4box's ISOFile write API.
 *
 * ## Know what this fixture is before trusting it
 *
 * mp4box's `addSample` write API emits a FRAGMENTED file: ftyp + moov(mvex) +
 * one moof/mdat pair per sample. Most real phone uploads are progressive
 * instead (ftyp + moov with populated stbl + one big mdat), and those are not
 * the same demux path.
 *
 * The measured consequence is worth stating rather than discovering later: on
 * this file `createFile(false)` still returns all 300 samples with their bytes
 * intact. The inverted-flag trap is PROGRESSIVE-file behaviour and this fixture
 * does not reproduce it. So it is a good fixture for "does the fast path decode
 * vp09 end to end" and a bad one for "would we catch a `createFile(false)`
 * regression". `test-mp4box-contract.mjs` stays the cover for the latter.
 */

const VP9 = {
  width: 320,
  height: 240,
  fps: 30,
  seconds: 10,
  timescale: 90_000,
  codec: "vp09.00.10.08",
};
VP9.frames = VP9.fps * VP9.seconds;
VP9.sampleDuration = VP9.timescale / VP9.fps;

/**
 * A VPCodecConfigurationRecord (vpcC), version 1.
 *
 * mp4box's `vpcC` box can PARSE this and has no `write()` of its own, so it
 * inherits `Box.prototype.write`, which emits `this.data` verbatim after the
 * FullBox header. The box is therefore built by handing it the post-header
 * payload as `.data` and letting the generic writer do the rest.
 */
function buildVpcC(BoxCtor) {
  const box = new BoxCtor("vpcC");
  box.version = 1;
  box.flags = 0;
  box.data = new Uint8Array([
    0x00, // profile 0
    0x0a, // level 1.0
    // bitDepth(4)=8 | chromaSubsampling(3)=1 (4:2:0 colocated) | fullRange(1)=0
    (8 << 4) | (1 << 1) | 0,
    0x01, // colourPrimaries: BT.709
    0x01, // transferCharacteristics: BT.709
    0x01, // matrixCoefficients: BT.709
    0x00,
    0x00, // codecInitializationDataSize = 0
  ]);
  return box;
}

/** Encode VP9 in the page, because Node has no `VideoEncoder`. */
async function encodeVp9(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The real origin: `VideoEncoder` is [SecureContext] and about:blank is not one.
  await page.goto(`${BASE}/en/collect`, { waitUntil: "domcontentloaded" });
  try {
    const result = await page.evaluate(async (cfg) => {
      if (typeof VideoEncoder === "undefined") return { error: "VideoEncoder missing" };

      const canvas = document.createElement("canvas");
      canvas.width = cfg.width;
      canvas.height = cfg.height;
      const ctx = canvas.getContext("2d");

      // Same rule as the WebM: every frame visibly different, or the stuck
      // detector downstream would be right to abort us.
      const draw = (i) => {
        const t = i / cfg.frames;
        ctx.fillStyle = `hsl(${Math.round(t * 360)}, 70%, 45%)`;
        ctx.fillRect(0, 0, cfg.width, cfg.height);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(
          cfg.width / 2 + Math.cos(t * Math.PI * 4) * (cfg.width * 0.3),
          cfg.height / 2 + Math.sin(t * Math.PI * 4) * (cfg.height * 0.3),
          24,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.font = "bold 64px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i).padStart(3, "0"), cfg.width / 2, cfg.height / 2);
      };

      const chunks = [];
      let decoderConfig = null;
      let encodeError = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          chunks.push({ type: chunk.type, b64: btoa(bin) });
        },
        error: (e) => {
          encodeError = String(e);
        },
      });

      const support = await VideoEncoder.isConfigSupported({
        codec: cfg.codec,
        width: cfg.width,
        height: cfg.height,
        bitrate: 800_000,
        framerate: cfg.fps,
      });
      if (!support.supported) return { error: `encoder config unsupported: ${cfg.codec}` };

      encoder.configure({
        codec: cfg.codec,
        width: cfg.width,
        height: cfg.height,
        bitrate: 800_000,
        framerate: cfg.fps,
        latencyMode: "quality",
      });

      for (let i = 0; i < cfg.frames; i += 1) {
        draw(i);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1_000_000) / cfg.fps),
          duration: Math.round(1_000_000 / cfg.fps),
        });
        // A keyframe a second keeps the file seekable and gives the decoder
        // somewhere to start.
        encoder.encode(frame, { keyFrame: i % cfg.fps === 0 });
        frame.close();
        if (encoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 0));
      }
      await encoder.flush();
      encoder.close();
      if (encodeError) return { error: encodeError };

      return {
        chunks,
        // VP9 carries no `description`, which is normal and is why the demux's
        // null-description branch is not a bug for this codec.
        hasDescription: Boolean(decoderConfig?.description),
      };
    }, VP9);

    if (result.error) throw new Error(`vp9 encode failed: ${result.error}`);
    return result;
  } finally {
    await context.close();
  }
}

/** Mux the chunks into an MP4 with mp4box's write API, in Node. */
async function muxVp9Mp4(chunks) {
  const mp4box = await import("mp4box");
  const { createFile } = mp4box;
  // mp4box does not export box classes at the top level. `BoxParser` IS the
  // registry, and it is the same object `addTrack` looks `options.type` up in.
  const vpcCCtor = mp4box.BoxParser?.box?.vpcC;
  if (!vpcCCtor) throw new Error("mp4box registry has no vpcC box");
  if (!mp4box.BoxParser?.sampleEntry?.vp09) throw new Error("mp4box registry has no vp09 sample entry");

  const total = VP9.frames * VP9.sampleDuration;
  const file = createFile(true); // NOT false: the flag is inverted internally.
  file.init({ timescale: VP9.timescale, duration: total });

  const trackId = file.addTrack({
    type: "vp09",
    timescale: VP9.timescale,
    width: VP9.width,
    height: VP9.height,
    duration: total,
    media_duration: total,
    description_boxes: [buildVpcC(vpcCCtor)],
  });
  // `addTrack` returns undefined SILENTLY for a type it does not know, so this
  // is the only place a missing vp09 entry would ever surface.
  if (trackId === undefined) throw new Error("addTrack returned undefined for vp09");

  chunks.forEach((c, i) => {
    file.addSample(trackId, new Uint8Array(Buffer.from(c.b64, "base64")), {
      duration: VP9.sampleDuration,
      dts: i * VP9.sampleDuration,
      cts: i * VP9.sampleDuration,
      is_sync: c.type === "key",
    });
  });

  const stream = file.getBuffer();
  return Buffer.from(stream.buffer ?? stream);
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/**
 * Fulfil the capture API in-browser so the happy path can be driven before the
 * ingest unit exists, and RECORD what the client actually put on the wire.
 *
 * The recording is the point. u27 proved the orchestration fires; what is new
 * here is what it carries: `mode: "video"` on the session, and the route's
 * `source` plus the `clockOffsetMs` on the finalize. Those two facts are the
 * unit, and asserting them anywhere but on the wire would be asserting our own
 * mock.
 */
async function mockCaptureApi(context) {
  const sessionId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  const seen = { createSession: null, finalize: null, frameBatches: [] };

  await context.route("**/api/capture/sessions", (route) => {
    seen.createSession = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId,
        uploadPrefix: `captures/${sessionId}`,
        maxFrames: 400,
        maxFrameBytes: 2097152,
      }),
    });
  });
  await context.route("**/api/capture/sessions/*/frames", async (route) => {
    const body = route.request().postDataJSON();
    seen.frameBatches.push(body.frames.length);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted: body.frames.map((f) => f.seq) }),
    });
  });
  await context.route("**/api/capture/sessions/*/finalize", (route) => {
    seen.finalize = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "matching" }),
    });
  });

  return { sessionId, seen };
}

/** Same boundary u27 stubs, for the same reason: the bucket does not exist yet. */
async function mockStorage(context) {
  await context.route("**/storage/v1/object/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

/**
 * Fail the session open with a chosen status, and touch nothing else.
 *
 * THIS REPLACES DRIVING THE REAL BACKEND, AND THE REASON MATTERS.
 *
 * u27's drive provoked a real failure by letting the upload hit the real capture
 * API, which was then a 501 stub: harmless, because a stub has no side effects.
 * That is no longer true. This build's `/api/capture/sessions` is implemented,
 * `.env.local` carries real Supabase credentials, so `getCaptureDb()` returns a
 * live database and an un-mocked upload from a verification script CREATES REAL
 * ROWS in it and pushes real frames at real storage. A drive must not do that.
 *
 * It is also not even reachable: `capture_create_session` (0013) enforces its own
 * 3/hour ceiling IN THE DATABASE, so the un-mocked path answers 429 rate_limited
 * on any machine that has run this more than three times in an hour, and no
 * server restart clears it because the counter is in Postgres, not in the
 * in-memory bucket.
 *
 * So the failure funnel is driven from a mocked status instead. That is
 * deterministic, side-effect free, and tests the thing actually worth testing:
 * that `classifyUploadError` maps a status onto an honest screen.
 */
async function mockCaptureFailure(context, status) {
  await context.route("**/api/capture/sessions", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unavailable" }),
    }),
  );
}

async function newContext(browser, locale, width = 390) {
  const context = await browser.newContext(
    width <= 430
      ? { ...devices["iPhone 13"], locale }
      : { viewport: { width, height: 900 }, locale },
  );
  context.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${message.text()}`);
  });
  context.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  return context;
}

/** Read the OPFS captures dir the same way u27 does: from inside the page. */
function readOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let captures;
    try {
      captures = await root.getDirectoryHandle("captures");
    } catch {
      return [];
    }
    const out = [];
    for await (const entry of captures.values()) {
      if (entry.kind !== "directory") continue;
      const dir = await captures.getDirectoryHandle(entry.name);
      const manifest = JSON.parse(
        await (await (await dir.getFileHandle("manifest.json")).getFile()).text(),
      );
      let frameFiles = 0;
      for await (const f of dir.values()) if (f.name.endsWith(".jpg")) frameFiles += 1;
      out.push({
        localId: manifest.localId,
        frames: manifest.frames.length,
        track: manifest.track.length,
        frameFiles,
        // `video` is the discriminant that tells a video session from a walk.
        // Its absence here would mean the manifest is not a video session at all.
        video: manifest.video
          ? {
              targetFrames: manifest.video.plan?.targetFrames ?? null,
              intervalMs: manifest.video.plan?.intervalMs ?? null,
              framesExtracted: manifest.video.framesExtracted ?? null,
              routeSource: manifest.video.route?.source ?? null,
              clockOffsetMs: manifest.video.clockOffsetMs ?? null,
            }
          : null,
      });
    }
    return out;
  });
}

/**
 * Watch the extract screen's decoder line for as long as extraction runs.
 *
 * The line only exists while the phase is `probing`/`extracting`, and a 12 s
 * video extracts in a couple of seconds, so a single read after the fact would
 * race the route screen and prove nothing. Polling collects every value the
 * screen ever showed, which is what the assertion actually wants.
 */
function watchDecoder(page) {
  const seen = new Set();
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      const text = await page
        .locator("text=DECODER")
        .first()
        .textContent()
        .catch(() => null);
      if (text) seen.add(text.replace(/\s+/g, " ").trim());
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  })();
  return {
    seen,
    async stop() {
      stopped = true;
      await done;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The drive
 * ------------------------------------------------------------------ */

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();

  const video = await synthesizeVideo(browser);
  check("a decodable video was synthesized in-browser", video.length > 1_000, `${video.length} B webm/vp8`);
  const videoFile = { name: "u28-synthetic-walk.webm", mimeType: "video/webm", buffer: video };
  const gpx = {
    name: "u28-synthetic-walk.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxFixture(Date.now() - VIDEO_MS), "utf8"),
  };

  /* ---------- Path A: the happy path, capture routes mocked ---------- */

  const context = await newContext(browser, "en");
  const { sessionId, seen } = await mockCaptureApi(context);
  await mockStorage(context);

  const page = await context.newPage();
  await page.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });

  check(
    "the chooser renders both ways in",
    (await page.getByTestId("choose-live").isVisible()) &&
      (await page.getByTestId("choose-upload").isVisible()),
  );
  await shoot(page, "u28-01-chooser-en-390-light");

  await page.getByTestId("choose-upload").click();
  check(
    "choose-upload reaches the video start screen",
    await sawText(page, "Upload a walk you already recorded."),
  );
  await shoot(page, "u28-02-start-en-390-light");

  const decoder = watchDecoder(page);
  await page.getByTestId("video-file-input").setInputFiles(videoFile);

  check("picking a video reaches the extract screen", await sawText(page, "Pulling the frames out"));
  await shoot(page, "u28-03-extract-en-390-light");

  // The route screen is the signal that extraction finished.
  await page.getByText("Tell us where this video went.").waitFor({ timeout: 90_000 });
  await decoder.stop();

  const decoderLines = [...decoder.seen];
  check(
    "the seek fallback ran, not WebCodecs",
    decoderLines.some((l) => /Video element/.test(l)) &&
      !decoderLines.some((l) => /WebCodecs/.test(l)),
    JSON.stringify(decoderLines),
  );

  check("the route screen is reached", true);
  await shoot(page, "u28-04-route-en-390-light");

  /* The plan, the UI's count and the manifest must all agree. */

  const opfsAtRoute = await readOpfs(page);
  const session = opfsAtRoute[0];
  check("OPFS holds exactly one session", opfsAtRoute.length === 1, JSON.stringify(opfsAtRoute.map((s) => s.localId)));
  check(
    "the manifest carries the video member with its plan",
    Boolean(session?.video && session.video.targetFrames !== null),
    JSON.stringify(session?.video),
  );

  // planExtraction(durationMs) at 1 fps is floor(duration/1000) for a short
  // video. The recorder never sees the duration, so this is derived from the
  // plan the app itself committed to, and then cross-checked against the frames
  // that actually landed.
  const target = session?.video?.targetFrames ?? -1;
  check(
    "the plan sampled at one frame a second",
    session?.video?.intervalMs === 1_000,
    `interval ${session?.video?.intervalMs} ms`,
  );
  check(
    "the plan targets one frame per second of video",
    target === Math.floor(VIDEO_MS / 1_000) || target === Math.floor(VIDEO_MS / 1_000) - 1,
    `${target} planned for a ~${VIDEO_MS / 1_000}s video`,
  );
  check(
    "every planned frame was extracted",
    session?.frames === target,
    `${session?.frames} extracted / ${target} planned`,
  );
  check(
    "every manifest frame has bytes on disk",
    session && session.frameFiles === session.frames,
    `${session?.frameFiles} files / ${session?.frames} meta`,
  );
  check(
    "the resume cursor kept up with the frames",
    session?.video?.framesExtracted === session?.frames,
    `cursor ${session?.video?.framesExtracted} / ${session?.frames} frames`,
  );

  /* The route step. */

  await page.getByTestId("gpx-file-input").setInputFiles(gpx);
  check(
    "a timed GPX is read and its point count reported",
    await sawText(page, `${GPX_POINTS} points read from ${gpx.name}.`),
  );
  check(
    "a timed GPX is recognised as carrying its own times",
    await sawText(page, "This file times every point, so those times are used as they are."),
  );
  check("the GPX is stated as the chosen route", await sawText(page, "The GPX will be used."));
  await shoot(page, "u28-05-route-gpx-en-390-light");

  await page.getByTestId("route-confirm").click();
  check("route-confirm reaches the review screen", await sawText(page, "Your video"));

  const reviewKept = await page
    .locator("span", { hasText: /^Frames kept$/ })
    .first()
    .locator("xpath=following-sibling::span[1]")
    .textContent()
    .catch(() => null);
  check(
    "the review screen reports the extracted frame count",
    Number.parseInt(reviewKept ?? "-1", 10) === session?.frames,
    `ui ${reviewKept} / manifest ${session?.frames}`,
  );

  const opfsAtReview = await readOpfs(page);
  check(
    "the route is recorded on the manifest as a gpx route",
    opfsAtReview[0]?.video?.routeSource === "gpx",
    `source ${opfsAtReview[0]?.video?.routeSource}`,
  );
  await shoot(page, "u28-06-review-en-390-light");

  /* The upload. */

  await page.getByTestId("video-upload").click();
  check("video-upload completes to the done screen", await sawText(page, "Your video is in", 30_000));
  await shoot(page, "u28-07-done-en-390-light");

  check(
    "createSession carried mode:video",
    seen.createSession?.mode === "video",
    JSON.stringify(seen.createSession),
  );
  check(
    "finalize carried the route source",
    seen.finalize?.source === "gpx",
    `source ${seen.finalize?.source}`,
  );
  check(
    "finalize carried a clockOffsetMs",
    typeof seen.finalize?.clockOffsetMs === "number",
    `clockOffsetMs ${seen.finalize?.clockOffsetMs}`,
  );
  check(
    "finalize carried a track as long as the GPX",
    Array.isArray(seen.finalize?.track) && seen.finalize.track.length === GPX_POINTS,
    `${seen.finalize?.track?.length} points`,
  );
  check(
    "every extracted frame was registered for upload",
    seen.frameBatches.reduce((a, b) => a + b, 0) === session?.frames,
    `${seen.frameBatches.reduce((a, b) => a + b, 0)} registered / ${session?.frames} extracted`,
  );

  // This is the assertion that found the leak. `useVideoUpload.upload` marked the
  // manifest `uploaded` and stopped, where the live sibling also sweeps, so every
  // frame of every successfully uploaded video stayed on the device forever and
  // the next upload stranded another set beside it. Fixed alongside this drive.
  const afterUpload = await readOpfs(page);
  check("OPFS is swept after a successful upload", afterUpload.length === 0, `${afterUpload.length} left`);

  await context.close();

  /* ---------- The honest failure states, from a mocked status ---------- */

  // See `mockCaptureFailure` for why this is mocked rather than provoked: the
  // capture backend is LIVE in this build and an un-mocked upload would write to
  // the project's real Supabase.
  const stub = await newContext(browser, "en");
  await mockCaptureFailure(stub, 501);
  const stubPage = await stub.newPage();
  await stubPage.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });
  await stubPage.getByTestId("choose-upload").click();
  await stubPage.getByTestId("video-file-input").setInputFiles(videoFile);
  await stubPage.getByText("Tell us where this video went.").waitFor({ timeout: 90_000 });
  await stubPage.getByTestId("gpx-file-input").setInputFiles(gpx);
  await stubPage.getByTestId("route-confirm").click();
  await stubPage.getByText("Your video").waitFor({ timeout: 10_000 });
  await stubPage.getByTestId("video-upload").click();

  check(
    "a 501 surfaces as the honest backend-not-live state",
    await sawText(stubPage, "Uploads are not switched on yet", 30_000),
  );
  check(
    "the retry affordance is offered after a failed upload",
    await sawText(stubPage, "Retry upload"),
  );
  const survived = await readOpfs(stubPage);
  check(
    "frames stay in OPFS after a failed upload",
    survived.length === 1 && (survived[0]?.frames ?? 0) > 0,
    `${survived.length} session(s), ${survived[0]?.frames} frames`,
  );
  await shoot(stubPage, "u28-08-backend-not-live-en-390-light");

  /* ---------- Regression: a video session is not an unfinished walk ---------- */

  // The manifests share one OPFS store, and `isSessionManifest` accepts a video
  // manifest by construction (it is a structural superset). Without the filter in
  // `useRecorder`, the half-uploaded video sitting in OPFS right now would be
  // offered to the live recorder as a walk to resume, and recovered into a
  // recorder that has no idea what to do with it. Fixed in d7f25c7; this is the
  // assertion that keeps it fixed.
  await stubPage.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });
  const stillThere = await readOpfs(stubPage);
  check(
    "a video session is still in OPFS for the regression to bite on",
    stillThere.length === 1 && stillThere[0]?.video !== null,
  );

  await stubPage.getByTestId("choose-live").click();
  check(
    "the live recorder still reaches its normal start screen",
    await sawText(stubPage, "Start recording"),
  );
  // Checked AFTER the start screen is up, and by counting rather than by a
  // negative wait: the recovery prompt and the start screen are alternatives, so
  // "the start screen is here" is what makes "the prompt is not" mean anything.
  check(
    "the live recorder does not offer a video session as an unfinished walk",
    await absentText(stubPage, "You have a walk that was never uploaded"),
  );
  await shoot(stubPage, "u28-09-live-not-offered-video-en-390-light");
  await stub.close();

  /* ---------- The state the live backend actually produces ---------- */

  // 503 is what /api/capture/sessions returns when `getCaptureDb()` is null, and
  // it is therefore the honest state a real contributor meets on a deployment
  // with no database wired. `classifyUploadError` has no 503 branch, so it lands
  // in `unknown` and says "Upload failed". That is honest and not a defect, but
  // it IS the copy a misconfigured production would show, so it is pinned here
  // rather than left to be discovered.
  {
    const down = await newContext(browser, "en");
    await mockCaptureFailure(down, 503);
    const downPage = await down.newPage();
    await downPage.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });
    await downPage.getByTestId("choose-upload").click();
    await downPage.getByTestId("video-file-input").setInputFiles(videoFile);
    await downPage.getByText("Tell us where this video went.").waitFor({ timeout: 90_000 });
    await downPage.getByTestId("gpx-file-input").setInputFiles(gpx);
    await downPage.getByTestId("route-confirm").click();
    await downPage.getByText("Your video").waitFor({ timeout: 10_000 });
    await downPage.getByTestId("video-upload").click();

    check("a 503 surfaces as an honest failure with a retry", await sawText(downPage, "Upload failed", 30_000));
    const kept = await readOpfs(downPage);
    check(
      "frames survive a 503 on the device",
      kept.length === 1 && (kept[0]?.frames ?? 0) > 0,
      `${kept.length} session(s), ${kept[0]?.frames} frames`,
    );
    await down.close();
  }

  /* ---------- The fast path, on a synthetic VP9-in-MP4 ---------- */

  // The whole reason this section exists: nothing else drives mp4box demux ->
  // VideoDecoder -> the reorder buffer -> the sampling targets, and a bug in
  // there is invisible (it reports zero frames, truthfully). See the header on
  // `encodeVp9` for what this fixture is and is not.
  try {
    const encoded = await encodeVp9(browser);
    const mp4 = await muxVp9Mp4(encoded.chunks);
    writeFileSync(path.join(OUT, "fixture-vp9.mp4"), mp4);
    check(
      "a VP9-in-MP4 fixture was muxed with mp4box",
      mp4.length > 10_000 && encoded.chunks.length === VP9.frames,
      `${mp4.length} B, ${encoded.chunks.length} samples, ${VP9.codec}`,
    );
    check(
      "VP9 carries no decoder description, as expected for this codec",
      encoded.hasDescription === false,
    );
    notes.push(
      `fixture: ${mp4.length} B, ${encoded.chunks.length} vp09 samples, ${VP9.seconds}s @ ${VP9.fps}fps, ${VP9.codec}`,
    );

    const fast = await newContext(browser, "en");
    const fastMocks = await mockCaptureApi(fast);
    await mockStorage(fast);
    const fastPage = await fast.newPage();
    await fastPage.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });
    await fastPage.getByTestId("choose-upload").click();
    await sawText(fastPage, "Upload a walk you already recorded.");

    const fastDecoder = watchDecoder(fastPage);
    await fastPage.getByTestId("video-file-input").setInputFiles({
      name: "u28-synthetic-walk.mp4",
      mimeType: "video/mp4",
      buffer: mp4,
    });
    const reachedRoute = await sawText(fastPage, "Tell us where this video went.", 90_000);
    await fastDecoder.stop();
    const fastLines = [...fastDecoder.seen];

    check(
      "the WebCodecs path ran on the VP9 MP4, not the seek fallback",
      fastLines.some((l) => /WebCodecs/.test(l)) && !fastLines.some((l) => /Video element/.test(l)),
      JSON.stringify(fastLines),
    );
    check("the WebCodecs path reaches the route screen", reachedRoute);

    const fastOpfs = await readOpfs(fastPage);
    const fastSession = fastOpfs[0];
    check(
      "the WebCodecs path extracted the planned frames",
      fastSession?.frames === fastSession?.video?.targetFrames && (fastSession?.frames ?? 0) > 0,
      `${fastSession?.frames} extracted / ${fastSession?.video?.targetFrames} planned`,
    );
    check(
      "the WebCodecs plan matches the MP4's demuxed duration",
      fastSession?.video?.targetFrames === VP9.seconds || fastSession?.video?.targetFrames === VP9.seconds - 1,
      `${fastSession?.video?.targetFrames} planned for a ${VP9.seconds}s mp4`,
    );
    check(
      "every WebCodecs frame has bytes on disk",
      fastSession && fastSession.frameFiles === fastSession.frames,
      `${fastSession?.frameFiles} files / ${fastSession?.frames} meta`,
    );
    await shoot(fastPage, "u28-15-webcodecs-route-en-390-light");

    // All the way to the wire, so the fast path is proven to produce the same
    // upload the seek path does rather than merely to decode.
    await fastPage.getByTestId("gpx-file-input").setInputFiles(gpx);
    await fastPage.getByTestId("route-confirm").click();
    await sawText(fastPage, "Your video");
    await fastPage.getByTestId("video-upload").click();
    check(
      "the WebCodecs path uploads to the done screen",
      await sawText(fastPage, "Your video is in", 30_000),
    );
    check(
      "the WebCodecs path finalizes with mode:video and the gpx source",
      fastMocks.seen.createSession?.mode === "video" && fastMocks.seen.finalize?.source === "gpx",
      JSON.stringify({ create: fastMocks.seen.createSession, source: fastMocks.seen.finalize?.source }),
    );
    await shoot(fastPage, "u28-16-webcodecs-done-en-390-light");
    await fast.close();
  } catch (error) {
    // A stretch that fails is reported as a gap, not smoothed over, and not
    // allowed to take the required seek coverage down with it.
    check("the WebCodecs path was exercised on a synthetic VP9 MP4", false, String(error));
    notes.push(`FAILED: ${String(error)}`);
  }

  /* ---------- Locale + width sweep ---------- */

  // EN and ES, phone and desktop. Light only: the capture flow's dark rendering
  // is u27's sweep and nothing on these screens themes differently.
  for (const [locale, chooserMarker, startMarker] of [
    ["en", "Two ways to hand us a street.", "Upload a walk you already recorded."],
    ["es", "Dos formas de entregarnos una calle.", "Subí una caminata que ya grabaste."],
  ]) {
    for (const width of [390, 1280]) {
      const c = await newContext(browser, locale, width);
      const p = await c.newPage();
      await p.emulateMedia({ colorScheme: "light" });
      await p.goto(`${BASE}/${locale}/collect`, { waitUntil: "networkidle" });
      check(`${locale} chooser renders at ${width}`, await sawText(p, chooserMarker));
      await shoot(p, `u28-10-chooser-${locale}-${width}-light`);

      await p.getByTestId("choose-upload").click();
      check(`${locale} video start screen renders at ${width}`, await sawText(p, startMarker));
      await shoot(p, `u28-11-start-${locale}-${width}-light`);

      // The route and review screens in both locales, at both widths. Driven the
      // long way (a real pick and a real extraction) because a screenshot of a
      // screen reached any other way is a screenshot of a different app.
      await p.getByTestId("video-file-input").setInputFiles(videoFile);
      await p.getByText(locale === "es" ? "Sacando los cuadros" : "Pulling the frames out")
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
      await shoot(p, `u28-12-extract-${locale}-${width}-light`);

      await p
        .getByText(locale === "es" ? "Decinos por dónde fue este video." : "Tell us where this video went.")
        .waitFor({ timeout: 90_000 });
      await shoot(p, `u28-13-route-${locale}-${width}-light`);

      await p.getByTestId("gpx-file-input").setInputFiles(gpx);
      await p.getByTestId("route-confirm").click();
      await p.getByText(locale === "es" ? "Tu video" : "Your video").waitFor({ timeout: 10_000 });
      check(`${locale} review screen renders at ${width}`, true);
      await shoot(p, `u28-14-review-${locale}-${width}-light`);

      await c.close();
    }
  }

  await browser.close();

  /* ---------- Console hygiene ---------- */

  // Four filters, each with a reason. Anything else is ours and fails the run.
  //
  //  - tiles/supabase/net::ERR/routing-network/501: third parties and the stub
  //    backend. Environmental, exactly as u27 filters them, and the 501 is
  //    deliberately provoked by the stub path above.
  //  - "[BoxParser] Invalid box type": mp4box being handed the WebM and failing
  //    to parse it. That is the seek fallback WORKING, not a fault: probeVideo
  //    throws, useVideoUpload falls back. Filtering it and not saying so would
  //    hide the best evidence in the run, so it is counted below.
  //  - hydration mismatch: an app-wide dev-server artifact on the <html> font
  //    classNames, reproduced on /en, /en/map and /es/collect alike with nothing
  //    from this unit on screen. Pre-existing and NOT u28's; reported here rather
  //    than owned. See playwright-drive.txt.
  const environmental =
    /tiles\.openfreemap|supabase|net::ERR|Failed to load resource|routing-network|501/i;
  const expectedBoxParser = /BoxParser|Invalid box type/i;
  const preexistingHydration = /hydrat|did not match|tree hydrated/i;
  const boxParserSeen = consoleErrors.filter((e) => expectedBoxParser.test(e)).length;
  const hydrationSeen = consoleErrors.filter((e) => preexistingHydration.test(e)).length;
  const ours = consoleErrors.filter(
    (e) => !environmental.test(e) && !expectedBoxParser.test(e) && !preexistingHydration.test(e),
  );
  check("no unexpected console errors in the driven flows", ours.length === 0, ours.join(" | "));
  check(
    "mp4box did refuse the WebM, which is what sends it down the seek path",
    boxParserSeen > 0,
    `${boxParserSeen} BoxParser errors`,
  );

  const failed = results.filter((r) => !r.ok);
  const report = [
    `u28 uploaded-video verification — ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `video: synthesized in-browser, canvas -> captureStream -> MediaRecorder(video/webm;codecs=vp8), ${VIDEO_MS / 1_000}s, ${video.length} B`,
    `route: a timed GPX fixture of ${GPX_POINTS} points over Escazú, built in memory`,
    "",
    "DECODER COVERAGE, STATED PLAINLY:",
    "  BOTH decoders are driven here, on two synthetic files, and which one ran is",
    "  asserted from the screen rather than assumed.",
    "",
    "  SEEK path (probeVideoElement + extractFramesWithSeek), on a VP8 WebM. Taken by",
    "  construction: mp4box cannot demux WebM, so probeVideo throws and useVideoUpload",
    "  falls back. The BoxParser errors in the console list below are that failure",
    "  happening, and they are counted as an assertion rather than merely filtered.",
    "",
    "  WEBCODECS path (mp4box demux + VideoDecoder), on a VP9 MP4 muxed here with",
    "  mp4box's own ISOFile write API. H.264 was not available to us at all: this",
    "  Chromium refuses to decode avc1, MediaRecorder.isTypeSupported('video/mp4;",
    "  codecs=avc1') is false, Playwright's bundled ffmpeg is built --disable-everything",
    "  (VP8/WebM only), and there is no system ffmpeg. VP9 was the only route to an MP4",
    "  mp4box would read, and it worked.",
    "",
    "  WHAT THE VP9 FIXTURE DOES NOT COVER, so nobody over-reads it: mp4box's addSample",
    "  API emits a FRAGMENTED mp4 (ftyp + moov(mvex) + a moof/mdat pair per sample).",
    "  Real phone uploads are progressive (ftyp + moov with populated stbl + one mdat),",
    "  and those are different demux paths. Measured: on this fixture createFile(false)",
    "  still returns all 300 samples with bytes intact, so it would NOT have caught the",
    "  inverted-keepMdatData bug of ddbc59f. scripts/test-mp4box-contract.mjs remains",
    "  the only cover for that, and the real-device checklist in MANUAL-VERIFY.md",
    "  remains the only cover for H.264 and for progressive files.",
    ...(notes.length > 0 ? ["", "PATH B (synthetic VP9-in-MP4):", ...notes.map((n) => `  ${n}`)] : []),
    "",
    "DEFECT FOUND AND FIXED BY THIS DRIVE:",
    "  useVideoUpload.upload() marked the manifest `uploaded` and stopped, where the",
    "  live sibling (useRecorder.upload, and its comment saying why) also calls",
    "  store.discard(). So every frame of every successfully uploaded video stayed in",
    "  OPFS forever: up to 400 JPEGs a video, with a fresh set stranded beside them on",
    "  the next upload, collected only if the contributor happened to click 'Upload",
    "  another video'. Caught by 'OPFS is swept after a successful upload' (1 left).",
    "",
    "PRE-EXISTING, NOT THIS UNIT'S:",
    `  ${hydrationSeen} React hydration mismatch(es) on the <html> font classNames.`,
    "  Reproduced on /en, /en/map and /es/collect with none of this unit's code on",
    "  screen, so it is filtered here and reported rather than owned or fixed.",
    "",
    "WHY THE FAILURE STATES ARE MOCKED AND NOT PROVOKED:",
    "  The capture API is NO LONGER a 501 stub in this build. /api/capture/sessions is",
    "  implemented and .env.local carries real Supabase credentials, so getCaptureDb()",
    "  returns a live database: an un-mocked upload from this script would create real",
    "  rows and push real frames at real storage. It is not reachable anyway, because",
    "  capture_create_session (0013) enforces its own 3/hour ceiling IN POSTGRES and",
    "  answers 429 regardless of server restarts. So 501 and 503 are both driven from a",
    "  mocked status: deterministic, side-effect free, and still exercising the real",
    "  classifyUploadError mapping. 'backend_not_live' is now a branch that the live",
    "  backend cannot actually produce; it is pinned as copy, not as a live state.",
    "",
    ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? `  (${r.detail})` : ""}`),
    "",
    `console errors seen: ${consoleErrors.length} (${consoleErrors.length - ours.length} filtered, ${ours.length} ours)`,
    `  of which mp4box refusing the WebM (expected, this is the fallback firing): ${boxParserSeen}`,
    `  of which pre-existing app-wide hydration mismatches (not this unit's): ${hydrationSeen}`,
    "",
    // Truncated: React dumps an entire component tree into a hydration warning,
    // and 27 kB of it buries every other line in this file. The full text is on
    // stdout if it is ever wanted.
    ...consoleErrors.map((e) => `  - ${e.replace(/\s+/g, " ").slice(0, 220)}`),
    "",
    failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.length})`,
  ].join("\n");
  writeFileSync(path.join(OUT, "playwright-drive.txt"), `${report}\n`);
  console.log(`\n${failed.length === 0 ? "PASS" : `FAIL — ${failed.length}`} — report in ${OUT}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
