#!/usr/bin/env node
/**
 * drive-ops-deck.mjs — browser evidence for unit-ops-deck.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const BASE = args[args.indexOf("--base") + 1] ?? "http://localhost:3586";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "u30-drive-secret";
const EVIDENCE = path.join(ROOT, ".planning", "evidence", "unit-ops-deck");
const SESSION = "3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

mkdirSync(EVIDENCE, { recursive: true });

const consoleLog = [];
const failures = [];
function check(label, ok) {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}`);
  if (!ok) failures.push(label);
}

async function loginCookie() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.find((c) => c.startsWith("sl_admin_session="));
  if (!cookie) throw new Error("no session cookie");
  const value = cookie.split(";")[0].split("=").slice(1).join("=");
  return { name: "sl_admin_session", value, url: BASE };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([await loginCookie()]);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleLog.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => consoleLog.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/en/admin/ops`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(EVIDENCE, "ops-dashboard.png"), fullPage: true });
  check("ops dashboard renders", (await page.content()).includes("Pipeline ops"));

  await page.goto(`${BASE}/en/admin/capture/${SESSION}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(EVIDENCE, "capture-review.png"), fullPage: true });
  check("capture review renders", (await page.content()).includes("camera walk") || (await page.content()).includes("submission"));

  writeFileSync(path.join(EVIDENCE, "console.log"), consoleLog.join("\n") + "\n");
  await browser.close();

  console.log(`\nEvidence → ${EVIDENCE}`);
  console.log(`Console errors: ${consoleLog.length}`);
  if (failures.length) {
    console.error(`FAIL — ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
