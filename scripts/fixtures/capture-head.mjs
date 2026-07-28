#!/usr/bin/env node
/**
 * capture-head.mjs — evidence helper (not a test suite; lives under fixtures/
 * so run-tests.mjs does not pick it up).
 *
 * Fetches every public route from a running server in both locales and writes
 * the metadata tags of each rendered <head> to one file per route.
 *
 * Usage: node scripts/fixtures/capture-head.mjs <baseUrl> <outDir>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , baseUrl, outDir] = process.argv;
if (!baseUrl || !outDir) {
  console.error("usage: capture-head.mjs <baseUrl> <outDir>");
  process.exit(2);
}

const ROUTES = ["", "map", "insights", "method", "rubric", "data", "brief", "press", "collect"];
const LOCALES = ["en", "es"];
const KEEP =
  /<title|name="description"|property="og:|name="twitter:|rel="canonical"|rel="alternate"|rel="icon"|rel="apple-touch-icon"|name="robots"|name="googlebot"|name="application-name"/i;

mkdirSync(outDir, { recursive: true });

let total = 0;
for (const locale of LOCALES) {
  for (const route of ROUTES) {
    const url = `${baseUrl}/${locale}${route ? `/${route}` : ""}`;
    const res = await fetch(url, { headers: { "user-agent": "Twitterbot/1.0" } });
    const html = await res.text();
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
    const tags = head
      .replace(/></g, ">\n<")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => KEEP.test(line));
    const name = `${locale}-${route || "landing"}.txt`;
    writeFileSync(
      path.join(outDir, name),
      `# ${url}  (HTTP ${res.status})\n${tags.join("\n")}\n`,
    );
    console.log(`${name}: ${tags.length} metadata tags (HTTP ${res.status})`);
    total += tags.length;
  }
}

for (const file of ["robots.txt", "sitemap.xml"]) {
  const res = await fetch(`${baseUrl}/${file}`);
  writeFileSync(path.join(outDir, file), await res.text());
  console.log(`${file}: HTTP ${res.status}`);
}

console.log(`\n${total} metadata tags captured across ${LOCALES.length * ROUTES.length} routes.`);
