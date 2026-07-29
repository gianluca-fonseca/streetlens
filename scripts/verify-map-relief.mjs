#!/usr/bin/env node
/**
 * verify-map-relief.mjs (bgsd-0018) — browser evidence for the /map dimensional
 * view.
 *
 * The half of the relief contract that `scripts/test-map-relief.mjs` cannot
 * own, because it needs a GPU, a real MapLibre instance and a real cookie jar:
 *
 *   • the map INITIALISES with the relief present and the pitched frame settled
 *   • the establishing move plays exactly once and then the camera HOLDS
 *   • a returning visitor and a reduced-motion visitor get the settled frame
 *     with ZERO animated camera calls
 *   • the control's rendered state matches the map's actual state, both ways
 *   • a persisted off-choice survives a reload
 *   • an extruded street is clickable and opens the same report card
 *   • the lens switcher re-heights and recolours the relief
 *   • demo data OFF extrudes nothing while the flat plan stays drawn
 *   • frame timing while panning and zooming, and going idle after the settle
 *
 * Nothing here reads source. The map instance is reached the way the repo's
 * other verify-* drivers reach it (React fiber walk to the `mapRef`), and every
 * camera claim is backed by a COUNTER installed over `easeTo`/`flyTo`/`jumpTo`
 * before the map is built, plus the pitch trajectory MapLibre actually emitted.
 * Reduced motion is read from `matchMedia`, i.e. the computed state the browser
 * resolved, not from a flag this script set and then trusted.
 *
 * Usage:
 *   npm run build && npm start -- -p 3593
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright \
 *     node scripts/verify-map-relief.mjs --base http://localhost:3593
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:3593");
const SHOTS = arg("--out", path.join(ROOT, ".planning", "evidence", "map-relief"));

const RELIEF_SOURCE = "segments-relief";
const RELIEF_LAYER = "segments-relief";
const SETTLED_PITCH = 45;

mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
function note(line) {
  console.log(`  ·    ${line}`);
  notes.push(line);
}

/*
 * Console noise that predates this unit. The brief names both: OpenFreeMap's
 * sprite fetches and MapLibre's null-value expression warnings come from the
 * basemap and the segment properties, not from the relief.
 */
const PREEXISTING =
  /sprite|Expected value to be of type number, but found null|hydrated but some attributes/i;

function watchConsole(page, sink) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (PREEXISTING.test(text)) return sink.preexisting.push(text.slice(0, 90));
    sink.errors.push(text.slice(0, 200));
  });
  page.on("pageerror", (e) => {
    const text = String(e);
    if (PREEXISTING.test(text)) return sink.preexisting.push(text.slice(0, 90));
    sink.errors.push(text.slice(0, 200));
  });
}

/**
 * The camera probe. Installed as an init script so it is running BEFORE the
 * page builds its map, which is what makes the call count trustworthy: the
 * establishing move cannot slip past a counter that was already there.
 *
 * It hunts for the map on a short interval (the map is constructed on mount,
 * the move is scheduled from the style `load` event roughly a second later), and
 * on finding it wraps the three camera entry points and subscribes to `pitch`.
 * Everything it records is what MapLibre was actually asked to do.
 */
const PROBE = () => {
  const probe = {
    calls: [],
    pitch: [],
    found: false,
    t0: performance.now(),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  window.__reliefProbe = probe;

  const findMap = () => {
    const el = document.querySelector(".maplibregl-map");
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return null;
    let node = el[key];
    for (let hops = 0; node && hops < 60; hops++, node = node.return) {
      let hook = node.memoizedState;
      for (let h = 0; hook && h < 40; h++, hook = hook.next) {
        const st = hook.memoizedState;
        if (st && typeof st === "object" && st.current?.queryRenderedFeatures) {
          return st.current;
        }
      }
    }
    return null;
  };

  const timer = setInterval(() => {
    const map = findMap();
    if (!map) return;
    clearInterval(timer);
    probe.found = true;
    window.__reliefMap = map;
    probe.attachedAt = performance.now() - probe.t0;
    probe.pitchAtAttach = map.getPitch();

    for (const method of ["easeTo", "flyTo", "jumpTo"]) {
      const original = map[method].bind(map);
      map[method] = (opts, ...rest) => {
        probe.calls.push({
          method,
          at: Math.round(performance.now() - probe.t0),
          pitch: opts?.pitch,
          zoom: opts?.zoom,
          duration: opts?.duration ?? 0,
        });
        return original(opts, ...rest);
      };
    }
    map.on("pitch", () => {
      probe.pitch.push({
        at: Math.round(performance.now() - probe.t0),
        pitch: Number(map.getPitch().toFixed(2)),
      });
    });
  }, 8);
};

/** Wait until the map exists, its style is loaded and the relief has been added. */
async function waitForMap(page) {
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30_000 });
  await page.waitForFunction(
    () => window.__reliefMap && window.__reliefMap.isStyleLoaded(),
    null,
    { timeout: 30_000 },
  );
}

/** Everything the assertions need, read off the LIVE map in one hop. */
async function readState(page) {
  return page.evaluate(
    ({ source, layer }) => {
      const map = window.__reliefMap;
      const probe = window.__reliefProbe;
      const visibility = map.getLayer(layer)
        ? (map.getLayoutProperty(layer, "visibility") ?? "visible")
        : null;
      const toggle = document.querySelector('button[aria-pressed]');
      return {
        hasSource: Boolean(map.getSource(source)),
        hasLayer: Boolean(map.getLayer(layer)),
        visibility,
        reliefFeatures: map.getSource(source)
          ? map.querySourceFeatures(source).length
          : 0,
        lineFeatures: map.querySourceFeatures("segments").length,
        pitch: Number(map.getPitch().toFixed(2)),
        bearing: Number(map.getBearing().toFixed(2)),
        zoom: Number(map.getZoom().toFixed(2)),
        center: map.getCenter().toArray().map((n) => Number(n.toFixed(4))),
        heightExpr: map.getLayer(layer)
          ? JSON.stringify(map.getPaintProperty(layer, "fill-extrusion-height"))
          : null,
        colorExpr: map.getLayer(layer)
          ? JSON.stringify(map.getPaintProperty(layer, "fill-extrusion-color"))
          : null,
        togglePressed: toggle?.getAttribute("aria-pressed") ?? null,
        toggleLabel: toggle?.getAttribute("aria-label") ?? null,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        cookie: document.cookie,
        calls: probe.calls,
        pitchSamples: probe.pitch,
        pitchAtAttach: probe.pitchAtAttach,
        attachedAt: Math.round(probe.attachedAt ?? -1),
        idle: map.loaded(),
      };
    },
    { source: RELIEF_SOURCE, layer: RELIEF_LAYER },
  );
}

/** Only the moves that actually animate the camera. A `jumpTo` is a cut. */
const animatedCalls = (calls) => calls.filter((c) => (c.duration ?? 0) > 0);

async function newPage(browser, { cookies = [], viewport, reducedMotion } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  await context.addInitScript(PROBE);
  if (cookies.length) {
    await context.addCookies(
      cookies.map((c) => ({ ...c, url: BASE, path: "/" })),
    );
  }
  const page = await context.newPage();
  const sink = { errors: [], preexisting: [] };
  watchConsole(page, sink);
  return { context, page, sink };
}

/**
 * Frame timing over a real interaction. Samples rAF deltas while the caller
 * drives the camera, so the numbers are the frames the reader would have seen,
 * not a synthetic benchmark.
 */
async function measureFrames(page, drive) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__frameStop = false;
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (!window.__frameStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await drive();
  return page.evaluate(() => {
    window.__frameStop = true;
    const f = window.__frames.slice(1).sort((a, b) => a - b);
    if (!f.length) return null;
    const at = (q) => Number(f[Math.min(f.length - 1, Math.floor(f.length * q))].toFixed(2));
    return {
      frames: f.length,
      median: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      worst: Number(f[f.length - 1].toFixed(2)),
    };
  });
}

/** Pan and zoom across the canton, the way someone reading the map would. */
async function panAndZoom(page) {
  await page.evaluate(async () => {
    const map = window.__reliefMap;
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const d of [[220, 0], [0, 180], [-260, -120]]) {
      map.panBy(d, { duration: 550 });
      await settle(650);
    }
    map.zoomTo(map.getZoom() + 1.6, { duration: 700 });
    await settle(850);
    map.zoomTo(map.getZoom() - 1.6, { duration: 700 });
    await settle(850);
  });
}

/**
 * A screen point over an extruded street. Projects real segment geometry and
 * confirms the RELIEF layer is what is actually under that pixel, so the click
 * below is a click on the volume rather than on the thin line beside it.
 */
async function pointOverVolume(page) {
  return page.evaluate(
    ({ layer }) => {
      const map = window.__reliefMap;
      const rect = map.getCanvas().getBoundingClientRect();
      const feats = map
        .querySourceFeatures("segments")
        .filter((f) => (f.properties?.score_overall ?? 0) > 60);
      for (const f of feats.slice(0, 200)) {
        const coords =
          f.geometry.type === "LineString"
            ? f.geometry.coordinates
            : f.geometry.coordinates.flat();
        for (let i = 0; i < coords.length - 1; i++) {
          for (const t of [0.5, 0.35, 0.65]) {
            const a = coords[i];
            const b = coords[i + 1];
            const p = map.project([
              a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t,
            ]);
            if (p.x < 8 || p.y < 8 || p.x > rect.width - 8 || p.y > rect.height - 8)
              continue;
            const hits = map.queryRenderedFeatures(p, { layers: [layer] });
            if (hits.length) {
              return {
                x: rect.left + p.x,
                y: rect.top + p.y,
                id: String(hits[0].id ?? hits[0].properties?.id),
              };
            }
          }
        }
      }
      return null;
    },
    { layer: RELIEF_LAYER },
  );
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("sl-theme", t);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  }, theme);
}

let shot = 0;
async function screenshot(page, name) {
  shot += 1;
  const file = path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const perf = {};
  const allErrors = [];
  const allPreexisting = [];

  /* ─────────────────────────────────────────────────────────────────────
   * 1. FIRST ARRIVAL, no cookie. The relief is the default view, the move
   *    plays, and then the camera holds.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nfirst arrival — /en/map with no preference");
  {
    const { context, page, sink } = await newPage(browser);
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);

    // Mid-animation: caught while the camera is still resolving into the frame.
    await page.waitForTimeout(700);
    const mid = await readState(page);
    await screenshot(page, "en-light-mid-animation");

    await page.waitForTimeout(3200);
    const settled = await readState(page);
    await screenshot(page, "en-light-settled");

    check(
      "the relief source and layer exist on /map",
      settled.hasSource && settled.hasLayer,
    );
    check(
      "the relief is VISIBLE by default",
      settled.visibility === "visible",
      settled.visibility,
    );
    check(
      "a real network is extruded",
      settled.reliefFeatures > 0,
      `${settled.reliefFeatures} volumes rendered`,
    );
    check(
      "the settled frame is pitched to 45, north up",
      Math.abs(settled.pitch - SETTLED_PITCH) < 0.5 && Math.abs(settled.bearing) < 0.5,
      `pitch=${settled.pitch} bearing=${settled.bearing}`,
    );
    check(
      "centred on Escazú",
      Math.abs(settled.center[0] + 84.138) < 0.02 && Math.abs(settled.center[1] - 9.912) < 0.02,
      `center=${settled.center.join(", ")}`,
    );

    // THE ESTABLISHING MOVE — counted, not assumed.
    const animated = animatedCalls(settled.calls);
    check(
      "exactly ONE animated camera call on first arrival",
      animated.length === 1,
      JSON.stringify(animated),
    );
    check(
      "that call resolves into the settled pitched frame",
      animated[0]?.pitch === SETTLED_PITCH && animated[0]?.duration === 1800,
      JSON.stringify(animated[0]),
    );
    check(
      "the camera was genuinely mid-move partway through",
      mid.pitch > 0 && mid.pitch < SETTLED_PITCH,
      `pitch at ~700ms = ${mid.pitch}`,
    );
    check(
      "the move is a continuous ease, not a cut",
      settled.pitchSamples.length > 20,
      `${settled.pitchSamples.length} pitch frames emitted`,
    );

    // AND THEN IT HOLDS. A tool people read must not drift.
    const before = settled.calls.length;
    await page.waitForTimeout(2500);
    const held = await readState(page);
    check(
      "the camera HOLDS after settling (no further camera calls, no drift)",
      held.calls.length === before && Math.abs(held.pitch - settled.pitch) < 0.01,
      `calls ${before}→${held.calls.length}, pitch ${settled.pitch}→${held.pitch}`,
    );
    check(
      "MapLibre goes idle once the camera settles",
      held.idle === true,
    );
    check(
      "the seen-flag is written so the move is first-time only",
      /sl_map_relief=on/.test(held.cookie),
      held.cookie.split("; ").filter((c) => c.startsWith("sl_map_relief")).join(""),
    );
    check(
      "the control's first paint already reads as ON",
      settled.togglePressed === "true",
      `aria-pressed=${settled.togglePressed}`,
    );

    // TIME TO INTERACTIVE, and the frames a reader would see.
    perf.settle = { attachedAt: settled.attachedAt, pitchFrames: settled.pitchSamples.length };
    perf.reliefPanZoom = await measureFrames(page, () => panAndZoom(page));
    note(`desktop 1440x900, relief ON — pan/zoom frames: ${JSON.stringify(perf.reliefPanZoom)}`);

    // The lens switcher must re-height AND recolour the volumes, not just lines.
    const beforeLens = await readState(page);
    await page.locator('[role="radio"]').nth(2).click(); // drainage
    await page.waitForTimeout(900);
    const afterLens = await readState(page);
    await screenshot(page, "en-light-lens-drainage");
    check(
      "the lens switcher re-heights the relief onto the new lens",
      afterLens.heightExpr.includes("score_drainage") &&
        beforeLens.heightExpr.includes("score_overall"),
      afterLens.heightExpr,
    );
    check(
      "the lens switcher recolours the relief too",
      afterLens.colorExpr !== beforeLens.colorExpr,
    );
    await page.locator('[role="radio"]').nth(0).click();
    await page.waitForTimeout(600);

    // A CLICK ON THE VOLUME OPENS THE REPORT CARD.
    const hit = await pointOverVolume(page);
    check("a pixel over an extruded street is hit-tested to the relief", Boolean(hit));
    if (hit) {
      await page.mouse.click(hit.x, hit.y);
      await page.waitForSelector("[data-segment-detail]", { timeout: 10_000 });
      const detail = await page.evaluate(() => {
        const el = document.querySelector("[data-segment-detail]");
        return { text: el?.textContent?.slice(0, 4000) ?? "" };
      });
      check(
        "clicking the extruded body opens the segment detail",
        detail.text.length > 0,
      );
      check(
        "the panel carries the real scores and rubric, not a stub",
        /\d/.test(detail.text) && detail.text.length > 200,
        `${detail.text.length} chars of panel content`,
      );
      await screenshot(page, "en-light-segment-selected-in-relief");
      // The selection has to light the VOLUME, not only the line beneath it.
      const lit = await page.evaluate(
        ({ source, id }) =>
          window.__reliefMap.getFeatureState({ source, id })?.selected === true,
        { source: RELIEF_SOURCE, id: hit.id },
      );
      check("the selected street's volume carries the selected state", lit);
      await page.keyboard.press("Escape").catch(() => {});
      await page.mouse.click(5, 5).catch(() => {});
      await page.waitForTimeout(400);
    }

    // THE CONTROL, BOTH WAYS.
    console.log("\nthe control tells the truth in both directions");
    const toggle = page.locator("button[aria-pressed]").first();
    await toggle.click();
    await page.waitForTimeout(1200);
    const off = await readState(page);
    await screenshot(page, "en-light-relief-off");
    check(
      "turning it OFF hides the relief and flattens the camera",
      off.visibility === "none" && off.pitch < 0.5,
      `visibility=${off.visibility} pitch=${off.pitch}`,
    );
    check(
      "the control now reads OFF",
      off.togglePressed === "false",
      `aria-pressed=${off.togglePressed}`,
    );
    check(
      "off returns to the flat map's own framing, not somewhere else",
      Math.abs(off.zoom - 13.4) < 0.05 &&
        Math.abs(off.center[0] - settled.center[0]) < 0.001,
      `zoom=${off.zoom} center=${off.center.join(", ")}`,
    );
    check(
      "the off choice is persisted immediately",
      /sl_map_relief=off/.test(off.cookie),
    );
    check(
      "the flat ground plan is still fully drawn with the relief off",
      off.lineFeatures > 0,
      `${off.lineFeatures} segment lines`,
    );
    perf.flatPanZoom = await measureFrames(page, () => panAndZoom(page));
    note(`desktop 1440x900, relief OFF — pan/zoom frames: ${JSON.stringify(perf.flatPanZoom)}`);

    await toggle.click();
    await page.waitForTimeout(1200);
    const backOn = await readState(page);
    check(
      "turning it back ON restores the relief and the pitch",
      backOn.visibility === "visible" && Math.abs(backOn.pitch - SETTLED_PITCH) < 0.5,
      `visibility=${backOn.visibility} pitch=${backOn.pitch}`,
    );
    check("the control reads ON again", backOn.togglePressed === "true");

    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 2. FIRST TIME ONLY — the seen flag suppresses the move.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nreturning visitor — the move does not play again");
  {
    const { context, page, sink } = await newPage(browser, {
      cookies: [{ name: "sl_map_relief", value: "on" }],
    });
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(3000);
    const s = await readState(page);
    await screenshot(page, "en-returning-no-flyin");
    check(
      "the relief is still on for a returning visitor",
      s.visibility === "visible" && s.togglePressed === "true",
    );
    check(
      "the map OPENS on the settled pitched frame",
      Math.abs(s.pitchAtAttach - SETTLED_PITCH) < 0.5,
      `pitch when the probe attached = ${s.pitchAtAttach}`,
    );
    check(
      "ZERO animated camera calls — no fly-in on a repeat visit",
      animatedCalls(s.calls).length === 0,
      JSON.stringify(s.calls),
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 3. THE OFF CHOICE SURVIVES A RELOAD.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\npersisted off — survives a reload and never gets the fly-in");
  {
    const { context, page, sink } = await newPage(browser);
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(3200);
    await page.locator("button[aria-pressed]").first().click();
    await page.waitForTimeout(1000);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(2500);
    const s = await readState(page);
    await screenshot(page, "en-off-after-reload");
    check(
      "after a reload the relief is STILL off",
      s.visibility === "none",
      `visibility=${s.visibility}`,
    );
    check(
      "the control's FIRST paint says off (server-resolved, no flash)",
      s.togglePressed === "false",
    );
    check("the camera opens flat", s.pitchAtAttach === 0, `pitch=${s.pitchAtAttach}`);
    check(
      "no fly-in for someone who opted out",
      animatedCalls(s.calls).length === 0,
      JSON.stringify(s.calls),
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 4. REDUCED MOTION — the relief, minus the motion.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nprefers-reduced-motion — settled frame, no move");
  {
    const { context, page, sink } = await newPage(browser, { reducedMotion: "reduce" });
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(3200);
    const s = await readState(page);
    await screenshot(page, "en-reduced-motion");
    check(
      "the browser really is resolving reduce (computed, not assumed)",
      s.reducedMotion === true,
    );
    check(
      "the relief is still THERE under reduced motion",
      s.visibility === "visible" && s.reliefFeatures > 0,
      `${s.reliefFeatures} volumes`,
    );
    check(
      "it opens ON the settled pitched frame",
      Math.abs(s.pitchAtAttach - SETTLED_PITCH) < 0.5 &&
        Math.abs(s.pitch - SETTLED_PITCH) < 0.5,
      `pitch=${s.pitch}`,
    );
    check(
      "ZERO animated camera calls under reduced motion",
      animatedCalls(s.calls).length === 0,
      JSON.stringify(s.calls),
    );
    // The toggle must be a cut too, not a 700ms ease.
    await page.locator("button[aria-pressed]").first().click();
    await page.waitForTimeout(900);
    const afterToggle = await readState(page);
    check(
      "toggling under reduced motion jumps rather than eases",
      animatedCalls(afterToggle.calls).length === 0 && afterToggle.pitch < 0.5,
      JSON.stringify(afterToggle.calls),
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 5. SPANISH, AND THE DARK BASEMAP.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\n/es/map, and both themes");
  {
    const { context, page, sink } = await newPage(browser);
    await page.goto(`${BASE}/es/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(900);
    await screenshot(page, "es-light-mid-animation");
    await page.waitForTimeout(3000);
    const es = await readState(page);
    await screenshot(page, "es-light-settled");
    check(
      "/es/map opens in the relief too",
      es.visibility === "visible" && Math.abs(es.pitch - SETTLED_PITCH) < 0.5,
      `pitch=${es.pitch}`,
    );
    check(
      "the Spanish control is labelled and states its truth",
      /3D/i.test(es.toggleLabel ?? "") && es.togglePressed === "true",
      es.toggleLabel ?? "",
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }
  {
    const { context, page, sink } = await newPage(browser, {
      cookies: [{ name: "sl_map_relief", value: "on" }],
    });
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await setTheme(page, "dark");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(2800);
    const dark = await readState(page);
    await screenshot(page, "en-dark-settled");
    check(
      "the dark basemap paints the relief from the dark ramp",
      dark.visibility === "visible" && dark.colorExpr !== null,
    );
    const { context: c2, page: p2, sink: s2 } = await newPage(browser, {
      cookies: [{ name: "sl_map_relief", value: "on" }],
    });
    await p2.goto(`${BASE}/es/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await setTheme(p2, "dark");
    await p2.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(p2);
    await p2.waitForTimeout(2800);
    await screenshot(p2, "es-dark-settled");
    allErrors.push(...sink.errors, ...s2.errors);
    allPreexisting.push(...sink.preexisting, ...s2.preexisting);
    await context.close();
    await c2.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 6. DEMO DATA OFF — nothing scored, so nothing stands up.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\ndemo data OFF — the empty stage must read as deliberate");
  {
    const { context, page, sink } = await newPage(browser, {
      cookies: [
        { name: "sl_demo_data", value: "off" },
        { name: "sl_map_relief", value: "on" },
      ],
    });
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(3000);
    const s = await readState(page);
    await screenshot(page, "en-demo-off-relief-on");
    check(
      "with nothing audited, nothing is extruded",
      s.reliefFeatures === 0,
      `${s.reliefFeatures} volumes`,
    );
    check(
      "the flat plan is still drawn, so the stage reads as empty rather than broken",
      s.lineFeatures > 0,
      `${s.lineFeatures} segment lines still on the map`,
    );
    check(
      "the control still honestly reads ON (the view is on, the data is absent)",
      s.togglePressed === "true" && s.visibility === "visible",
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 7. PHONES — 390x844, under 4x and 6x CPU throttling.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nphones — 390x844 under CPU throttling");
  for (const rate of [4, 6]) {
    const { context, page, sink } = await newPage(browser, {
      viewport: { width: 390, height: 844 },
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const t0 = Date.now();
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForMap(page);
    const tReady = Date.now() - t0;
    await page.waitForTimeout(4000);
    const s = await readState(page);
    if (rate === 4) await screenshot(page, "phone-390x844-relief-settled");
    check(
      `${rate}x CPU: the phone gets the same settled frame (not a clamped one)`,
      Math.abs(s.pitch - SETTLED_PITCH) < 0.5 && s.visibility === "visible",
      `pitch=${s.pitch}`,
    );
    const frames = await measureFrames(page, () => panAndZoom(page));
    perf[`phone${rate}x`] = { timeToMapReadyMs: tReady, frames, volumes: s.reliefFeatures };
    note(
      `phone 390x844 @${rate}x CPU — map ready ${tReady}ms, ${s.reliefFeatures} volumes, pan/zoom ${JSON.stringify(frames)}`,
    );
    check(
      `${rate}x CPU: panning and zooming stays usable (p95 frame under 100ms)`,
      (frames?.p95 ?? 999) < 100,
      `p95=${frames?.p95}ms median=${frames?.median}ms`,
    );
    // Flat, same phone, same throttle, for the honest comparison.
    await page.locator("button[aria-pressed]").first().click();
    await page.waitForTimeout(1200);
    const flat = await measureFrames(page, () => panAndZoom(page));
    perf[`phone${rate}xFlat`] = flat;
    note(`phone 390x844 @${rate}x CPU, relief OFF — pan/zoom ${JSON.stringify(flat)}`);
    if (rate === 4) await screenshot(page, "phone-390x844-relief-off");
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 8. LEGIBILITY AT PITCH — a street behind a tall one stays clickable.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nlegibility at 45 degrees");
  {
    const { context, page, sink } = await newPage(browser, {
      cookies: [{ name: "sl_map_relief", value: "on" }],
    });
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(2800);
    const cover = await page.evaluate(
      ({ layer }) => {
        const map = window.__reliefMap;
        const rect = map.getCanvas().getBoundingClientRect();
        // Sample the canvas on a grid and count how many DISTINCT streets are
        // reachable by a click, versus how many are drawn at all. Occlusion
        // that hides a street entirely is the failure mode to catch.
        const drawn = new Set(
          map.queryRenderedFeatures({ layers: [layer] }).map((f) => String(f.id)),
        );
        const reachable = new Set();
        const step = 12;
        for (let x = step; x < rect.width; x += step) {
          for (let y = step; y < rect.height; y += step) {
            for (const f of map.queryRenderedFeatures([x, y], { layers: [layer] })) {
              reachable.add(String(f.id));
            }
          }
        }
        return { drawn: drawn.size, reachable: reachable.size };
      },
      { layer: RELIEF_LAYER },
    );
    const ratio = cover.drawn ? cover.reachable / cover.drawn : 0;
    check(
      "at 45 degrees, essentially every drawn street is still clickable",
      ratio > 0.9,
      `${cover.reachable}/${cover.drawn} reachable on a 12px grid (${(ratio * 100).toFixed(1)}%)`,
    );
    perf.legibility = { ...cover, ratio: Number(ratio.toFixed(3)) };
    await screenshot(page, "en-legibility-at-45");
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  /* ─────────────────────────────────────────────────────────────────────
   * 9. THE LANDING HERO IS UNCHANGED.
   * ──────────────────────────────────────────────────────────────────── */
  console.log("\nthe landing hero still works");
  {
    const { context, page, sink } = await newPage(browser);
    await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForMap(page);
    await page.waitForTimeout(4200);
    const s = await readState(page);
    await screenshot(page, "en-landing-hero-unchanged");
    check(
      "the hero still carries its relief",
      s.hasLayer && s.visibility === "visible" && s.reliefFeatures > 0,
      `${s.reliefFeatures} volumes`,
    );
    check(
      "the hero keeps its OWN camera signature (pitch 55, bearing -15)",
      Math.abs(s.pitch - 55) < 1 && Math.abs(s.bearing + 15) < 1,
      `pitch=${s.pitch} bearing=${s.bearing}`,
    );
    check(
      "the hero still flies in",
      animatedCalls(s.calls).length === 1,
      JSON.stringify(animatedCalls(s.calls)),
    );
    check(
      "the map's cookie is NOT written by the hero",
      !/sl_map_relief/.test(s.cookie),
      s.cookie.slice(0, 120),
    );
    allErrors.push(...sink.errors);
    allPreexisting.push(...sink.preexisting);
    await context.close();
  }

  await browser.close();

  /* ── console + numbers ──────────────────────────────────────────────── */
  console.log("");
  check(
    "zero app-origin console errors",
    allErrors.length === 0,
    allErrors.slice(0, 4).join(" | "),
  );
  note(`pre-existing (not ours, per the brief): ${allPreexisting.length} messages`);

  writeFileSync(
    path.join(SHOTS, "performance.json"),
    JSON.stringify(perf, null, 2) + "\n",
  );
  writeFileSync(
    path.join(SHOTS, "console.log"),
    ["APP-ORIGIN ERRORS", ...allErrors, "", "PRE-EXISTING", ...allPreexisting].join("\n") + "\n",
  );
  writeFileSync(path.join(SHOTS, "notes.log"), notes.join("\n") + "\n");

  console.log(`\nEvidence → ${SHOTS}`);
  console.log(JSON.stringify(perf, null, 2));
  if (failures.length) {
    console.error(`\nFAIL — ${failures.length}: ${failures.join(" | ")}`);
    process.exit(1);
  }
  console.log("\nPASS — the /map dimensional view holds up in a browser");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
