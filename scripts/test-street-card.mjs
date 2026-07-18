#!/usr/bin/env node
/**
 * test-street-card.mjs — street permalink + deep-link contract
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-street-links");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

console.log("street link helpers");
rmSync(BUILD_DIR, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "lib/street-links.ts",
    "--outDir",
    BUILD_DIR,
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--target",
    "ES2020",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
  ],
  { cwd: ROOT, stdio: "pipe" },
);
const links = require(path.join(BUILD_DIR, "street-links.js"));
check("streetPath", links.streetPath("esc-sa-0001") === "/street/esc-sa-0001");
check(
  "mapSegmentPath encodes",
  links.mapSegmentPath("esc/sa") === "/map?segment=esc%2Fsa",
);
check(
  "absoluteStreetUrl",
  links.absoluteStreetUrl("en", "esc-sa-0001", "https://streetlens.test") ===
    "https://streetlens.test/en/street/esc-sa-0001",
);

console.log("");
console.log("route surfaces exist");
check("street page", read("app/[locale]/street/[segmentId]/page.tsx").includes("getStreetCard"));
check("og image", read("app/[locale]/street/[segmentId]/opengraph-image.tsx").includes("ImageResponse"));
check("map segment param", read("app/[locale]/map/page.tsx").includes("initialSegmentId"));
check("AuditMap initialSegmentId", read("components/AuditMap.tsx").includes("initialSegmentId"));
check("Hero street links", read("components/landing/Hero.tsx").includes("streetPath"));
check("SegmentDetail share", read("components/SegmentDetail.tsx").includes("StreetShareActions"));

console.log("");
console.log("i18n street namespace");
for (const loc of ["en", "es"]) {
  const m = JSON.parse(read(`messages/${loc}.json`)).street;
  check(`${loc}: street.share.copyLink`, m?.share?.copyLink?.length > 0);
  check(`${loc}: street.og.eyebrow`, m?.og?.eyebrow?.length > 0);
}

console.log("");
console.log("seeded segment store present");
try {
  execFileSync("node", ["scripts/seed-provenance-drive.mjs", "--clean"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("node", ["scripts/seed-provenance-drive.mjs", "--force"], { cwd: ROOT, stdio: "pipe" });
  const cv = JSON.parse(read("data/community-cv-observations.local.json"));
  check("seed writes CV observations", Array.isArray(cv) && cv.length > 0);
  check("seed targets esc-sa-0001", cv.some((o) => o.segment_id === "esc-sa-0001"));
} catch (e) {
  check("seed provenance drive", false, e.message);
}

console.log("");
if (failures.length === 0) {
  console.log("PASS — street card contract");
  process.exit(0);
}
console.error(`FAIL — ${failures.length} check(s): ${failures.join(", ")}`);
process.exit(1);
