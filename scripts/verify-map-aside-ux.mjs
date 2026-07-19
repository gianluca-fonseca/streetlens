#!/usr/bin/env node
/**
 * verify-map-aside-ux.mjs (bgsd-0016)
 *
 * Browser evidence on port 3591: outside-tap closing, aside collapsed/expanded
 * at desktop + 390px, both themes one shot each.
 *
 * Usage:
 *   next dev -p 3591
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/verify-map-aside-ux.mjs --base http://localhost:3591
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const args = process.argv.slice(2);
const BASE = args[args.indexOf("--base") + 1] ?? "http://localhost:3591";
const SEG = "esc-sa-0001";
const SHOTS = path.join(ROOT, ".planning", "evidence", "map-aside-ux");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const PREEXISTING = /hydrated but some attributes of the server rendered HTML didn't match/i;

function watchConsole(page, sink) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (PREEXISTING.test(text)) return sink.preexisting.push(text.slice(0, 80));
    sink.errors.push(text.slice(0, 200));
  });
  page.on("pageerror", (e) => sink.errors.push(String(e).slice(0, 200)));
}

async function openSegmentOnPage(page, segmentId) {
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 20_000 });
  await page.waitForTimeout(2500);

  const ready = await page.evaluate(async (id) => {
    const el = document.querySelector(".maplibregl-map");
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let node = el[key];
    let map = null;
    for (let hops = 0; node && hops < 60 && !map; hops++, node = node.return) {
      let hook = node.memoizedState;
      for (let h = 0; hook && h < 40; h++, hook = hook.next) {
        const st = hook.memoizedState;
        if (st && typeof st === "object" && st.current?.queryRenderedFeatures) {
          map = st.current;
          break;
        }
      }
    }
    if (!map) return null;
    window.__asideMap = map;

    const find = () =>
      map.querySourceFeatures("segments", { filter: ["==", ["get", "id"], id] });
    let feats = find();
    for (let i = 0; i < 40 && feats.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      feats = find();
    }
    if (!feats.length) return null;

    const coords = feats[0].geometry.coordinates;
    map.jumpTo({ center: coords[Math.floor(coords.length / 2)], zoom: 17 });
    await new Promise((r) => (map.loaded() ? r() : map.once("idle", r)));
    return { ready: true };
  }, segmentId);
  if (!ready) return null;

  await page.waitForTimeout(1500);
  const hit = await page.evaluate((id) => {
    const map = window.__asideMap;
    const feats = map.querySourceFeatures("segments", {
      filter: ["==", ["get", "id"], id],
    });
    if (!feats.length) return null;
    const candidates = [];
    for (const f of feats) {
      const coords = f.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const [a, b] = [coords[i], coords[i + 1]];
        for (const t of [0.5, 0.35, 0.65]) {
          candidates.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
    }
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    for (const [lng, lat] of candidates) {
      const p = map.project([lng, lat]);
      const x = rect.left + p.x;
      const y = rect.top + p.y;
      const top = document.elementFromPoint(x, y);
      if (top === canvas || canvas.contains(top)) return { x, y };
    }
    return null;
  }, segmentId);

  if (!hit) return null;
  await page.mouse.click(hit.x, hit.y);
  await page.waitForSelector("[data-segment-detail]", { timeout: 10_000 });
  return hit;
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("streetlens-theme", t);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  }, theme);
}

async function shoot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function panelToggle(page) {
  return page.locator("[data-map-panel] button[aria-controls='map-panel-collapsible']");
}

async function runViewport(browser, width, height, theme, tag) {
  const sink = { errors: [], preexisting: [] };
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  watchConsole(page, sink);

  await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded" });
  await setTheme(page, theme);
  await page.reload({ waitUntil: "domcontentloaded" });

  const hit = await openSegmentOnPage(page, SEG);
  check(`${tag}: segment detail opens`, !!hit);

  await shoot(page, `${tag}-detail-open`);

  // Outside tap on map chrome (top-left corner away from panel + detail).
  await page.mouse.click(24, height - 24);
  await page.waitForTimeout(400);
  const closed = (await page.locator("[data-segment-detail]").count()) === 0;
  check(`${tag}: outside tap closes detail`, closed);
  await shoot(page, `${tag}-outside-tap-closed`);

  // Panel collapsed / expanded
  await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded" });
  await setTheme(page, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-map-panel][data-panel-hydrated='true']", {
    timeout: 15_000,
  });
  const toggle = await panelToggle(page);
  const startsExpanded = (await toggle.getAttribute("aria-expanded")) === "true";
  if (startsExpanded) {
    await toggle.click();
    await page.waitForTimeout(350);
    check(`${tag}: panel collapses`, (await toggle.getAttribute("aria-expanded")) === "false");
    await shoot(page, `${tag}-panel-collapsed`);
    const provVisible = (await page.locator("[data-testid='provenance-note']").count()) > 0 ||
      (await page.locator("[data-map-panel]").textContent()).includes("camera");
    check(`${tag}: provenance or panel headline still visible when collapsed`, provVisible);
    await toggle.click();
    await page.waitForTimeout(350);
    check(`${tag}: panel expands`, (await toggle.getAttribute("aria-expanded")) === "true");
    await shoot(page, `${tag}-panel-expanded`);
  } else {
    check(`${tag}: panel starts collapsed on phone`, true);
    await shoot(page, `${tag}-panel-collapsed`);
    const provVisible = (await page.locator("[data-testid='provenance-note']").count()) > 0 ||
      (await page.locator("[data-map-panel]").textContent()).includes("camera");
    check(`${tag}: provenance or panel headline still visible when collapsed`, provVisible);
    await toggle.click();
    await page.waitForTimeout(350);
    check(`${tag}: panel expands`, (await toggle.getAttribute("aria-expanded")) === "true");
    await shoot(page, `${tag}-panel-expanded`);
    await toggle.click();
    await page.waitForTimeout(350);
    check(`${tag}: panel collapses`, (await toggle.getAttribute("aria-expanded")) === "false");
  }

  check(`${tag}: no console errors`, sink.errors.length === 0, sink.errors.join(" | "));
  await context.close();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  console.log("\nDesktop light");
  await runViewport(browser, 1280, 800, "light", "01-desktop-light");

  console.log("\nDesktop dark");
  await runViewport(browser, 1280, 800, "dark", "02-desktop-dark");

  console.log("\nPhone light (390px)");
  await runViewport(browser, 390, 844, "light", "03-phone-light");

  console.log("\nPhone dark (390px)");
  await runViewport(browser, 390, 844, "dark", "04-phone-dark");

  await browser.close();

  console.log("");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`PASS — evidence in ${SHOTS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
