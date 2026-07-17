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
 * The capture API routes are 501 stubs until the ingest unit lands, so this
 * covers BOTH paths: the mocked happy path (routes fulfilled in-browser, proving
 * the client's create -> register -> upload -> finalize orchestration) and the
 * real 501 (proving the honest "uploads are not switched on yet" state with the
 * frames still safe on the device).
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
  await page.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });

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

  /* ---------- Path B: the real 501 stubs ---------- */

  const stub = await newContext(browser, "en");
  const stubPage = await stub.newPage();
  await stubPage.goto(`${BASE}/en/collect`, { waitUntil: "networkidle" });
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

  /* ---------- Locale + theme sweep ---------- */

  for (const [locale, marker] of [
    ["en", "Start recording"],
    ["es", "Empezar a grabar"],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const c = await newContext(browser, locale);
      const p = await c.newPage();
      await p.emulateMedia({ colorScheme: scheme });
      await p.goto(`${BASE}/${locale}/collect`, { waitUntil: "networkidle" });
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
  const ours = consoleErrors.filter(
    (e) => !/tiles\.openfreemap|supabase|net::ERR|Failed to load resource/i.test(e),
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
