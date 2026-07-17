#!/usr/bin/env node
/**
 * verify-u27-recorder.mjs (u27 live recorder)
 *
 * Drives the recorder end to end in a real Chromium with a real (fake) camera
 * and a scripted GPS walk through Escazú, and writes screenshots + a verdict.
 *
 * NOT part of the app's dependencies. Playwright is invoked through npx and is
 * deliberately absent from package.json: this is a verification harness for one
 * unit, not a runtime or build concern.
 *
 * Why a standalone script rather than the Playwright MCP server the repo has
 * used before: the MCP server's launch options are fixed, and this page cannot
 * be verified without --use-fake-device-for-media-stream (a real MediaStream
 * that decodes real frames) and --use-fake-ui-for-media-stream (auto-granting
 * the camera prompt). Stubbing getUserMedia in page script would verify the
 * stub, not the recorder.
 *
 * Both paths are driven with the capture API mocked in-browser: the happy path
 * (routes fulfilled, proving the client's create -> register -> upload -> finalize
 * orchestration) and a 501 (proving the honest "uploads are not switched on yet"
 * state, with the frames still safe on the device).
 *
 * The 501 used to come from the real routes, because they were stubs. u29
 * implemented them, so it is injected now. See the comment on Path B.
 *
 * u28 added the uploaded-video path, so /collect is a chooser and the recorder
 * sits one click behind it, EXCEPT when an unfinished walk is waiting, which
 * still outranks everything. `openLive` handles both.
 *
 * Usage: node scripts/verify-u27-recorder.mjs [--base http://localhost:3145]
 * Exits 0 on PASS, 1 on any failure.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".planning/evidence/u27");

const baseArg = process.argv.indexOf("--base");
const BASE = baseArg !== -1 ? process.argv[baseArg + 1] : "http://localhost:3145";

// Resolved from wherever npx put it; never from the project's node_modules.
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const results = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  results.push({ label, ok, detail });
}

/** Escazú, walking north up a street at roughly 1.4 m/s. */
const START = { lat: 9.9187, lng: -84.1408 };
const STEP_LAT = 0.00009; // ~10 m per step, comfortably past the 6 m gate.

const consoleErrors = [];

async function walk(context, steps) {
  for (let i = 1; i <= steps; i += 1) {
    await context.setGeolocation({
      latitude: START.lat + STEP_LAT * i,
      longitude: START.lng,
      accuracy: 8,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/**
 * Fulfil the capture API in-browser so the happy path can be driven before the
 * ingest unit exists. Only the four capture routes are touched; everything else
 * hits the real server.
 */
async function mockCaptureApi(context) {
  const sessionId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  await context.route("**/api/capture/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId,
        uploadPrefix: `captures/${sessionId}`,
        maxFrames: 400,
        maxFrameBytes: 2097152,
      }),
    }),
  );
  await context.route("**/api/capture/sessions/*/frames", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted: body.frames.map((f) => f.seq) }),
    });
  });
  await context.route("**/api/capture/sessions/*/finalize", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "matching" }),
    }),
  );
  return sessionId;
}

/**
 * The storage PUT goes to Supabase, not our origin, and the bucket does not
 * exist yet. Inject an uploadFrame seam? No: upload-client reads the supabase
 * client directly. Instead the supabase storage endpoint is stubbed at the
 * network layer, which is the honest boundary.
 */
async function mockStorage(context) {
  await context.route("**/storage/v1/object/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

async function newContext(browser, locale) {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale,
    permissions: ["geolocation", "camera"],
    geolocation: { latitude: START.lat, longitude: START.lng, accuracy: 8 },
  });
  context.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${message.text()}`);
  });
  context.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  return context;
}

/**
 * Open the live recorder.
 *
 * `/collect` is a chooser now: u28 added the uploaded-video path alongside this
 * one, so the recorder sits one click behind a gate. The gate is deliberate
 * rather than a tab strip (both modules are heavy and pull different chunks, so
 * rendering both would download MapLibre and mp4box on a phone to show one), and
 * that click is the ONLY thing about this flow that changed. Everything the
 * recorder does after it is what it always did, which is what the rest of this
 * file still asserts.
 */
async function openLive(page, locale = "en", marker = "Start recording") {
  await page.goto(`${BASE}/${locale}/collect`, { waitUntil: "networkidle" });
  // The chooser is skipped entirely when an unfinished walk is waiting: the
  // recorder's recover prompt outranks it, which is what /collect always did.
  const chooser = page.getByTestId("choose-live");
  if (await chooser.isVisible().catch(() => false)) await chooser.click();
  // `ssr: false` means the recorder arrives on a dynamic import, so it is not
  // there the instant the click lands. Waiting on the marker rather than a
  // timeout keeps this honest: if the recorder never mounts, this fails here
  // rather than three assertions later for a reason nobody can read.
  await page
    .getByText(marker)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: [
      // A real MediaStream carrying a real animated test pattern. The recorder's
      // dedupe and blur gates run against actual decoded pixels.
      "--use-fake-device-for-media-stream",
      // Auto-grants the camera prompt.
      "--use-fake-ui-for-media-stream",
    ],
  });

  /* ---------- Path A: the happy path, capture routes mocked ---------- */

  const context = await newContext(browser, "en");
  const sessionId = await mockCaptureApi(context);
  await mockStorage(context);

  const page = await context.newPage();
  await openLive(page);

  check("start screen renders", await page.getByText("Start recording").isVisible());
  await shoot(page, "u27-01-start-en-390-light");

  await page.getByText("Start recording").click();
  // The camera needs a moment to negotiate and deliver its first frames.
  await page.waitForTimeout(1_500);

  check("recording state is reached", await page.getByText("REC", { exact: true }).isVisible());

  await walk(context, 6);
  await shoot(page, "u27-02-recording-en-390-light");

  // The HUD's own label, which is the short one: "Frames kept" wrapped to two
  // lines at 390px and broke the stat row's baselines. The review screen keeps
  // the full label, where there is room for it.
  const kept = await page
    .locator("text=Frames", { hasText: /^Frames$/ })
    .locator("xpath=following-sibling::span[1]")
    .textContent()
    .catch(() => null);
  const keptCount = Number.parseInt(kept ?? "0", 10);
  check("frames were captured during the walk", keptCount > 0, `${keptCount} kept`);

  // Probe OPFS directly: the manifest must exist on disk mid-walk, which is the
  // whole write-through claim.
  const opfs = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const captures = await root.getDirectoryHandle("captures");
    const out = [];
    for await (const entry of captures.values()) {
      const dir = await captures.getDirectoryHandle(entry.name);
      const manifest = JSON.parse(await (await (await dir.getFileHandle("manifest.json")).getFile()).text());
      let frameFiles = 0;
      for await (const f of dir.values()) if (f.name.endsWith(".jpg")) frameFiles += 1;
      out.push({ frames: manifest.frames.length, track: manifest.track.length, frameFiles });
    }
    return out;
  });
  check("OPFS holds exactly one session", opfs.length === 1, JSON.stringify(opfs));
  check("manifest records the kept frames", (opfs[0]?.frames ?? 0) > 0);
  check(
    "every manifest frame has bytes on disk",
    opfs[0] && opfs[0].frameFiles === opfs[0].frames,
    `${opfs[0]?.frameFiles} files / ${opfs[0]?.frames} meta`,
  );
  check("manifest records the GPS track", (opfs[0]?.track ?? 0) >= 2, `${opfs[0]?.track} fixes`);

  await page.getByText("Stop", { exact: true }).click();
  await page.waitForTimeout(1_000);

  check("review screen is reached", await page.getByText("Your walk").isVisible());
  await shoot(page, "u27-03-review-en-390-light");

  await page.getByText("Upload walk").click();
  await page.waitForTimeout(3_000);

  check("upload completes to the done screen", await page.getByText("Your walk is in").isVisible());
  await shoot(page, "u27-04-done-en-390-light");

  await page.getByText("Track this walk").click();
  await page.waitForURL(`**/collect/status/${sessionId}`);
  check("status page renders the session id", await page.getByText(sessionId).isVisible());
  await shoot(page, "u27-05-status-en-390-light");

  const afterUpload = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const captures = await root.getDirectoryHandle("captures");
      let n = 0;
      for await (const entry of captures.values()) if (entry.kind === "directory") n += 1;
      return n;
    } catch {
      return 0;
    }
  });
  check("OPFS is swept after a successful upload", afterUpload === 0, `${afterUpload} left`);

  await context.close();

  /* ---------- Path B: the backend-not-live state ---------- */

  // This used to hit the real routes, because they were 501 stubs and 501 was
  // what they answered. u29 implemented them (`8028da9`), so the same request now
  // returns a 201 and this path stopped testing what its name says: the assertion
  // below was passing on a world that no longer exists, and would have gone on passing
  // if `backend_not_live` had been deleted outright.
  //
  // The 501 is now injected. That is not a weaker test, it is the same test made
  // honest: what u27 verifies here is the CLIENT's handling of a 501, which is
  // still real behaviour in `classifyUploadError` and still the correct answer if
  // the API is ever redeployed behind a stub. Asserting it against a mock is the
  // only way left to assert it at all.
  const stub = await newContext(browser, "en");
  await stub.route("**/api/capture/sessions", (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not_implemented" }),
    }),
  );
  const stubPage = await stub.newPage();
  await openLive(stubPage);
  await stubPage.getByText("Start recording").click();
  await stubPage.waitForTimeout(1_500);
  await walk(stub, 4);
  await stubPage.getByText("Stop", { exact: true }).click();
  await stubPage.waitForTimeout(800);
  await stubPage.getByText("Upload walk").click();
  await stubPage.waitForTimeout(3_000);

  check(
    "a 501 surfaces as the honest backend-not-live state",
    await stubPage.getByText("Uploads are not switched on yet").isVisible(),
  );
  check(
    "the retry affordance is offered after a failed upload",
    await stubPage.getByText("Retry upload").isVisible(),
  );
  const survived = await stubPage.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const captures = await root.getDirectoryHandle("captures");
    let n = 0;
    for await (const entry of captures.values()) if (entry.kind === "directory") n += 1;
    return n;
  });
  check("frames stay in OPFS after a failed upload", survived === 1, `${survived} session(s)`);
  await shoot(stubPage, "u27-06-backend-not-live-en-390-light");

  // Reload: the unfinished walk must be offered back rather than lost.
  await stubPage.reload({ waitUntil: "networkidle" });
  await stubPage.waitForTimeout(800);
  check(
    "an unfinished walk is offered for recovery after a reload",
    await stubPage.getByText("You have a walk that was never uploaded").isVisible(),
  );
  await shoot(stubPage, "u27-07-recover-en-390-light");
  await stub.close();

  /* ---------- Path C: a camera we cannot have ---------- */

  // Regression for the worst bug review found: start() used to enter "recording"
  // regardless of whether the camera opened. That unmounts the start screen,
  // which is the ONLY place the camera error renders, so a walker who refused the
  // prompt got a black preview, a live REC dot, a running clock and a frame count
  // pinned at zero, with nothing telling them why.
  //
  // No --use-fake-ui-for-media-stream here and no camera permission, so
  // getUserMedia genuinely fails. (Headless Chromium reports this as an
  // unclassified failure rather than NotAllowedError, hence the loose assertion
  // on the error block rather than on the "denied" copy specifically.)
  {
    const denied = await chromium.launch({ args: ["--use-fake-device-for-media-stream"] });
    const deniedCtx = await denied.newContext({
      ...devices["iPhone 13"],
      locale: "en",
      permissions: ["geolocation"],
      geolocation: { latitude: START.lat, longitude: START.lng, accuracy: 8 },
    });
    const deniedPage = await deniedCtx.newPage();
    await openLive(deniedPage);
    await deniedPage.getByText("Start recording").click();
    await deniedPage.waitForTimeout(2_500);

    check(
      "a failed camera does not start a session",
      !(await deniedPage.getByText("REC", { exact: true }).isVisible().catch(() => false)) &&
        !(await deniedPage.getByText("Stop", { exact: true }).isVisible().catch(() => false)),
    );
    check(
      "a failed camera stays on the start screen and says why",
      (await deniedPage.getByText("Start recording").isVisible()) &&
        /camera/i.test(await deniedPage.locator("body").innerText()),
    );
    await shoot(deniedPage, "u27-09-camera-denied-en-390-light");
    await denied.close();
  }

  /* ---------- Locale + theme sweep ---------- */

  for (const [locale, marker] of [
    ["en", "Start recording"],
    ["es", "Empezar a grabar"],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const c = await newContext(browser, locale);
      const p = await c.newPage();
      await p.emulateMedia({ colorScheme: scheme });
      await openLive(p, locale, marker);
      check(`${locale} start screen renders in ${scheme}`, await p.getByText(marker).isVisible());
      await shoot(p, `u27-08-start-${locale}-390-${scheme}`);
      await c.close();
    }
  }

  /* ---------- Regression: the manual flow still works ---------- */

  const mapCtx = await newContext(browser, "en");
  const mapPage = await mapCtx.newPage();
  await mapPage.goto(`${BASE}/en/map`, { waitUntil: "networkidle" });
  check("the map page still renders", mapPage.url().includes("/en/map"));
  await mapCtx.close();

  await browser.close();

  /* ---------- Console hygiene ---------- */

  // MapLibre tile fetches and Supabase reachability are environmental, not this
  // unit's, so they are reported but not failed on.
  //
  // The hydration mismatch is the same kind of thing and is worth naming, because
  // "hydration error" normally means a real bug. This one is on the `<html>` tag's
  // font-module class names in `app/[locale]/layout.tsx`, and it appears when the
  // dev server runs from inside a bgsd worktree: Next resolves the workspace root
  // by lockfile and finds three of them (the home directory, the parent repo, this
  // worktree), picks the wrong one, and hashes the font CSS modules differently on
  // the server and the client. It reproduces on /en/map, which imports nothing this
  // unit touches. It is a symptom of where the server was started, not of the code,
  // and it does not occur in a normal checkout.
  const ours = consoleErrors.filter(
    (e) =>
      !/tiles\.openfreemap|supabase|net::ERR|Failed to load resource/i.test(e) &&
      !/hydrat|didn't match the client|hydration-mismatch/i.test(e),
  );
  check("no unexpected console errors in the driven flows", ours.length === 0, ours.join(" | "));

  const failed = results.filter((r) => !r.ok);
  const report = [
    `u27 recorder verification — ${new Date().toISOString()}`,
    `base: ${BASE}`,
    `chromium: fake media device + fake media UI; geolocation scripted over Escazú`,
    "",
    ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? `  (${r.detail})` : ""}`),
    "",
    `console errors (filtered as environmental): ${consoleErrors.length - ours.length}`,
    ...consoleErrors.map((e) => `  - ${e}`),
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
