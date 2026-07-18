#!/usr/bin/env node
/**
 * verify-canonical-observation.mjs (u32, issue #19)
 *
 * Drives the public map in a real browser against the two-walk fixture from
 * seed-provenance-drive.mjs and proves the thing the owner asked for: the most
 * recently WALKED approved observation is what the segment says it is, and the
 * older reading is tucked under an archive disclosure instead of sitting beside
 * it as an equal peer.
 *
 * The fixture (esc-sa-0001) carries two approved observations: a March walk
 * scoring 54 overall and a July walk scoring 71. If canonical selection works,
 * the panel shows 71 and never 54 until the archive is opened. Those numbers
 * are the whole assertion — with the old identical-scores fixture, a broken
 * implementation and a correct one rendered the same pixels.
 *
 * Follows u27/u30 precedent: playwright is deliberately NOT a package.json
 * dependency, so point PLAYWRIGHT_MODULE at an npx-installed one.
 *
 * Usage:
 *   node scripts/seed-provenance-drive.mjs
 *   next dev -p 3563                            # with NO Supabase env (local mode)
 *   PLAYWRIGHT_MODULE=$(…) node scripts/verify-canonical-observation.mjs --base http://localhost:3563
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
const BASE = args[args.indexOf("--base") + 1] ?? "http://localhost:3563";
const SEG = "esc-sa-0001";
const SHOTS = path.join(ROOT, ".planning", "evidence", "canonical-observation");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** See verify-u30-review-loop.mjs — the pre-existing hydration offender. */
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

/**
 * Click the map segment, at a pixel where it is genuinely the top feature.
 * Lifted from verify-u30-review-loop.mjs — same map, same hit-test problem.
 */
async function openSegment(page, locale, segmentId) {
  await page.goto(`${BASE}/${locale}/map`, { waitUntil: "domcontentloaded" });
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
    window.__u32map = map;

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
    const map = window.__u32map;
    const feats = map.querySourceFeatures("segments", {
      filter: ["==", ["get", "id"], id],
    });
    if (!feats.length) return null;
    const candidates = [];
    for (const f of feats) {
      const coords = f.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const [a, b] = [coords[i], coords[i + 1]];
        for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
          candidates.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      candidates.push(...coords);
    }
    for (const c of candidates) {
      const p = map.project(c);
      if (p.x < 20 || p.y < 20 || p.x > window.innerWidth - 20 || p.y > window.innerHeight - 20)
        continue;
      const hits = map.queryRenderedFeatures([
        [p.x - 2, p.y - 2],
        [p.x + 2, p.y + 2],
      ]);
      const first = hits.find((h) => h.properties?.id);
      if (first?.properties.id === id) return { x: Math.round(p.x), y: Math.round(p.y) };
    }
    return null;
  }, segmentId);
  if (!hit) return null;

  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(700);
  return hit;
}

/**
 * NOTE on the case-insensitive matches below: these labels carry a CSS
 * `uppercase` transform and innerText returns the TRANSFORMED text, so an
 * exact-case regex silently fails against a perfectly correct render.
 */
async function shoot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function main() {
  const browser = await chromium.launch();
  const sink = { errors: [], preexisting: [] };

  try {
    /* ---------------- EN, light, desktop ---------------- */
    console.log("\ndetail panel — EN, 1440, light");
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    watchConsole(page, sink);

    const hit = await openSegment(page, "en", SEG);
    check("the two-walk segment opens on the map", hit !== null);
    const panel = page.locator("section[role=dialog]").first();
    let text = await panel.innerText();

    check(
      "the chip says the observation was APPROVED",
      /Approved camera observation · not yet field-audited/.test(text),
    );
    check(
      "and still refuses to claim field verification",
      !/field.verified/i.test(text.split("Archive")[0]) ||
        /not yet field-audited/.test(text),
    );
    check(
      "the note explains approval vs field audit as two steps",
      /An admin reviewed this camera reading and approved it/.test(text) &&
        /separate, stricter step that has not happened/.test(text),
    );

    check(
      "the CURRENT observation is the one shown",
      /Current camera observation/.test(text),
    );
    check(
      "it is the JULY walk (overall 71), not the March one (54)",
      /\b71\b/.test(text) && !/\b54\b/.test(text),
      "canonical = latest captured_on",
    );
    check(
      "the superseded reading is NOT rendered as a peer",
      !/Superseded/i.test(text),
      "collapsed by default",
    );
    check(
      "the canonical ASSESSMENT is the July one",
      /repaved since the earlier pass/.test(text) &&
        !/missing curb ramp at the corner/.test(text),
      "model synthesis follows the canonical reading",
    );
    check(
      "the archive toggle is present with a count",
      /Archive · past observations/i.test(text) && /\(1\)/.test(text),
    );
    await shoot(page, "01-en-light-default-canonical-archive-collapsed");

    /* ---------------- Archive expanded ---------------- */
    console.log("\narchive expanded — EN");
    const toggle = page.locator("button[aria-controls=cv-archive]").first();
    check("the toggle starts collapsed", (await toggle.getAttribute("aria-expanded")) === "false");
    await toggle.click();
    await page.waitForTimeout(500);
    check("the toggle reports expanded", (await toggle.getAttribute("aria-expanded")) === "true");
    text = await panel.innerText();
    check("the archived card is now visible", /Superseded/i.test(text));
    check(
      "the superseded MARCH reading appears only once opened (overall 54)",
      /\b54\b/.test(text),
    );
    check(
      "and its own assessment travels with it",
      /missing curb ramp at the corner/.test(text),
    );
    check("both walk dates are on screen", /March/.test(text) && /July/.test(text), "walked dates");
    await shoot(page, "02-en-light-archive-expanded-superseded");
    await ctx.close();

    /* ---------------- ES ---------------- */
    console.log("\ndetail panel — ES, 1440, light");
    const esCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
    });
    const esPage = await esCtx.newPage();
    watchConsole(esPage, sink);
    const esHit = await openSegment(esPage, "es", SEG);
    check("the segment opens in ES", esHit !== null);
    const esPanel = esPage.locator("section[role=dialog]").first();
    let esText = await esPanel.innerText();
    check(
      "ES chip is translated (no EN leakage)",
      /Observación de cámara aprobada · aún sin auditoría de campo/.test(esText),
    );
    check("ES shows the current observation label", /Observación de cámara actual/.test(esText));
    check("ES archive toggle is translated", /Archivo · observaciones anteriores/i.test(esText));
    await shoot(esPage, "03-es-light-canonical-archive-collapsed");
    const esToggle = esPage.locator("button[aria-controls=cv-archive]").first();
    await esToggle.click();
    await esPage.waitForTimeout(500);
    esText = await esPanel.innerText();
    check("ES superseded tag is translated", /Reemplazada/i.test(esText));
    await shoot(esPage, "04-es-light-archive-expanded");
    await esCtx.close();

    /* ---------------- Console ---------------- */
    console.log("\nconsole");
    check(
      "zero console errors",
      sink.errors.length === 0,
      sink.errors.length ? `\n    ${sink.errors.slice(0, 4).join("\n    ")}` : "",
    );
    console.log(
      `  [note] ${sink.preexisting.length} PRE-EXISTING hydration-mismatch errors filtered ` +
        `(predates u32; see verify-u30-review-loop.mjs)`,
    );
  } finally {
    await browser.close();
  }

  console.log(
    failures.length === 0
      ? "\nPASS — the latest walk is the segment's state; the rest is archive"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
