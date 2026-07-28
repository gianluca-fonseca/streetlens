#!/usr/bin/env node
/**
 * verify-demo-runtime-toggle.mjs (bgsd-0018)
 *
 * Browser evidence that the demo era flips LIVE, against one running server that
 * is never restarted or rebuilt between states.
 *
 * The run, in order: land on /en/map with no cookie (demo ON by default, honesty
 * strip up, audited figures published), click the switch once (demo OFF, strip
 * gone, audited figures degraded to zero), click it again (demo ON again).
 * Also drives it from the keyboard, since the control claims role="switch".
 *
 * Usage:
 *   next dev -p 3592
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright \
 *   node scripts/verify-demo-runtime-toggle.mjs --base http://localhost:3592 --shots <dir>
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
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:3592");
const SHOTS = arg("--shots", path.join(ROOT, ".planning", "evidence", "demo-runtime-toggle"));

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const PREEXISTING = /hydrated but some attributes of the server rendered HTML didn't match/i;

/** Everything the page says about which era it is in, in one read. */
async function readEra(page) {
  return page.evaluate(() => {
    const sw = document.querySelector('[role="switch"]');
    const banner = document.querySelector('[role="status"]');
    const figures = [...document.querySelectorAll("dd")].map((d) => d.textContent.trim());
    return {
      switchChecked: sw?.getAttribute("aria-checked") ?? null,
      switchName: sw?.textContent?.trim() ?? null,
      bannerVisible: Boolean(banner && banner.textContent.trim().length > 0),
      bannerText: banner?.textContent?.trim().slice(0, 60) ?? null,
      figures,
      nan: document.body.innerText.includes("NaN"),
    };
  });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();

  const sink = { errors: [], preexisting: [] };
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (PREEXISTING.test(text)) return sink.preexisting.push(text.slice(0, 80));
    sink.errors.push(text.slice(0, 200));
  });
  page.on("pageerror", (e) => sink.errors.push(String(e).slice(0, 200)));

  try {
    // ── State 1: no cookie at all. The build-time default must publish. ───────
    console.log("first load, no cookie (default era):");
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="switch"]', { timeout: 30_000 });
    await page.waitForTimeout(2500);

    const cookiesBefore = await context.cookies();
    check(
      "no sl_demo_data cookie yet (this is the pure default)",
      !cookiesBefore.some((c) => c.name === "sl_demo_data"),
    );

    const on = await readEra(page);
    console.log(`  -> ${JSON.stringify(on)}`);
    check("demo data is ON by default", on.switchChecked === "true");
    check("switch has an accessible name", Boolean(on.switchName));
    check("honesty strip is up while demo data is on", on.bannerVisible, on.bannerText ?? "");
    check("audited figures are published", on.figures.some((f) => /\d/.test(f) && f !== "0"));
    check("no NaN on the page", !on.nan);
    await page.screenshot({ path: path.join(SHOTS, "01-demo-on-default.png") });

    // ── Flip OFF. Same server, same build, no restart. ────────────────────────
    console.log("");
    console.log("click the switch -> demo OFF:");
    await page.click('[role="switch"]');
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false",
      { timeout: 30_000 },
    );
    await page.waitForTimeout(2500);

    const off = await readEra(page);
    console.log(`  -> ${JSON.stringify(off)}`);
    check("switch reports off", off.switchChecked === "false");
    check("honesty strip is gone (nothing simulated left to label)", !off.bannerVisible);
    check("no NaN in the real-data era", !off.nan);
    check(
      "no orphaned '0 audited' headline (hideAuditedZeros honored)",
      !off.figures.includes("0"),
      JSON.stringify(off.figures),
    );
    const offCookie = (await context.cookies()).find((c) => c.name === "sl_demo_data");
    check("cookie written", offCookie?.value === "off", offCookie?.value ?? "(missing)");
    check("cookie path is /", offCookie?.path === "/", offCookie?.path ?? "");
    check("cookie is SameSite=Lax", offCookie?.sameSite === "Lax", offCookie?.sameSite ?? "");
    check(
      "cookie outlives the session",
      typeof offCookie?.expires === "number" && offCookie.expires > Date.now() / 1000 + 86_400,
    );
    await page.screenshot({ path: path.join(SHOTS, "02-demo-off.png") });

    // The real-data era must survive a fresh navigation, not just a refresh.
    await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const landingOff = await page.evaluate(() => ({
      nan: document.body.innerText.includes("NaN"),
      empty: document.body.innerText.trim().length < 400,
    }));
    check("landing renders in the real-data era", !landingOff.empty && !landingOff.nan);
    await page.screenshot({ path: path.join(SHOTS, "03-landing-demo-off.png"), fullPage: false });

    // ── Flip back ON, from the keyboard this time. ────────────────────────────
    console.log("");
    console.log("keyboard the switch -> demo ON again:");
    await page.goto(`${BASE}/en/map`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="switch"]', { timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.focus('[role="switch"]');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "switch",
    );
    check("switch is focusable", focused);
    await page.screenshot({ path: path.join(SHOTS, "04-switch-focus-ring.png") });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true",
      { timeout: 30_000 },
    );
    await page.waitForTimeout(2500);

    const backOn = await readEra(page);
    console.log(`  -> ${JSON.stringify(backOn)}`);
    check("switch reports on again", backOn.switchChecked === "true");
    check("honesty strip is back with the data", backOn.bannerVisible);
    check("audited figures are published again", backOn.figures.some((f) => /\d/.test(f) && f !== "0"));
    const onCookie = (await context.cookies()).find((c) => c.name === "sl_demo_data");
    check("cookie flipped back", onCookie?.value === "on", onCookie?.value ?? "(missing)");
    await page.screenshot({ path: path.join(SHOTS, "05-demo-on-again.png") });

    console.log("");
    check("no console errors", sink.errors.length === 0, sink.errors.join(" | "));
    if (sink.preexisting.length) {
      console.log(`  (ignored ${sink.preexisting.length} pre-existing hydration warning(s))`);
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`PASS — the era flipped both ways against one running server (shots in ${SHOTS})`);
}

main().catch((err) => {
  console.error(`[verify] crashed: ${err}`);
  process.exit(1);
});
