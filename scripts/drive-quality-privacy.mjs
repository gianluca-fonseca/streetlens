#!/usr/bin/env node
/**
 * Drive unit-quality-privacy evidence on port 3585.
 * Expects: local-mode next (no Supabase) + seed-provenance-drive seeded.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3585";
const SEG = "esc-sa-0001";
const OUT = path.join(ROOT, ".planning", "evidence", "unit-quality-privacy");
mkdirSync(OUT, { recursive: true });

const log = [];
function note(line) {
  console.log(line);
  log.push(line);
}

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
    window.__qpMap = map;
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
    const map = window.__qpMap;
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
  await page.waitForTimeout(1200);
  return hit;
}

async function main() {
  const browser = await chromium.launch();
  const consoleErrors = [];

  try {
    for (const locale of ["en", "es"]) {
      note(`\n--- ${locale.toUpperCase()} map detail ---`);
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      });
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(`[${locale}] ${m.text().slice(0, 200)}`);
      });

      const apis = await page.evaluate(async (base) => {
        const detail = await fetch(`${base}/api/segments/esc-sa-0001/detail`).then(async (r) => ({
          status: r.status,
          body: await r.json(),
        }));
        const evidence = await fetch(`${base}/api/segments/esc-sa-0001/evidence`).then(async (r) => ({
          status: r.status,
          body: await r.json(),
        }));
        return { detail, evidence };
      }, BASE);

      const obs = apis.detail.body.cv_observations?.[0];
      note(`  detail ${apis.detail.status}; cv=${apis.detail.body.cv_observations?.length ?? 0}`);
      note(`  assessment EN: ${obs?.assessment?.overall?.slice(0, 60) ?? "(none)"}`);
      note(`  assessment ES: ${obs?.assessment_es?.overall?.slice(0, 60) ?? "(none)"}`);
      note(
        `  scrub: session_id=${"session_id" in (obs || {})} frame_refs=${"frame_refs" in (obs || {})} frame_count=${obs?.frame_count}`,
      );
      note(`  evidence: ${JSON.stringify(apis.evidence.body)}`);

      const hit = await openSegment(page, locale, SEG);
      note(`  openSegment: ${hit ? `clicked ${hit.x},${hit.y}` : "FAILED"}`);
      await page.waitForTimeout(800);

      const panelText = await page.locator("body").innerText();
      const expectAssessment =
        locale === "es"
          ? /Acera|repavimentada|rampa/i
          : /Sidewalk|Broken sidewalk|curb ramp/i;
      note(`  panel has locale assessment: ${expectAssessment.test(panelText)}`);
      note(`  panel has photos heading: ${/photos|fotos/i.test(panelText)}`);
      note(
        `  panel evidence empty/held: ${/held for review|en revisión|unavailable|no disponible/i.test(panelText)}`,
      );

      await page.screenshot({
        path: path.join(OUT, `map-detail-${locale}.png`),
        fullPage: false,
      });
      note(`  screenshot: map-detail-${locale}.png`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  writeFileSync(path.join(OUT, "console.log"), consoleErrors.join("\n") || "(no console errors)\n");
  writeFileSync(path.join(OUT, "drive.log"), log.join("\n") + "\n");
  note(`\nWrote evidence to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
