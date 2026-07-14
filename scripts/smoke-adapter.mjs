#!/usr/bin/env node
/**
 * smoke-adapter.mjs
 *
 * End-to-end smoke test of the static-fallback data adapter plus a contract
 * check of lib/segments.ts's frozen export surface (advisor rev 4).
 *
 * - Compiles lib/{types,supabase,segments}.ts to CJS in .smoke-build/ and
 *   exercises getSegments / getSegmentDetail / getStats with no Supabase env.
 * - Asserts every feature carries district, audited_at, all four score_*
 *   fields, and demo: true.
 * - Asserts the module's export names match the frozen list exactly:
 *   runtime exports via require(), type-only exports via source inspection.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".smoke-build");
const require = createRequire(import.meta.url);

const FROZEN_EXPORTS = [
  "ScoreLayer",
  "SCORE_LAYERS",
  "SegmentProperties",
  "SegmentCollection",
  "SegmentDetail",
  "StreetStats",
  "getSegments",
  "getSegmentDetail",
  "getStats",
];
const RUNTIME_EXPORTS = new Set(["SCORE_LAYERS", "getSegments", "getSegmentDetail", "getStats"]);

const failures = [];
function check(label, ok, detail = "") {
  const status = ok ? "ok " : "FAIL";
  console.log(`  [${status}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function main() {
  // 1. Export-surface check on the TypeScript source (covers type-only exports).
  const source = await fs.readFile(path.join(ROOT, "lib", "segments.ts"), "utf8");
  console.log("Export surface (lib/segments.ts source):");
  for (const name of FROZEN_EXPORTS) {
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`),
      new RegExp(`export\\s+(type\\s+|const\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`, "s"),
      new RegExp(`export\\s+(type|const|interface)\\s+${name}\\b`),
    ];
    check(`exports ${name}`, patterns.some((re) => re.test(source)));
  }
  check(
    "no stale `Stats` export name",
    !/export[^;{]*\bStats\b(?!\w)/.test(source.replace(/StreetStats/g, "X")),
  );

  // 2. Compile to CJS and exercise the fallback path (no Supabase env).
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc", "lib/types.ts", "lib/supabase.ts", "lib/segments.ts",
      "--outDir", BUILD_DIR, "--module", "commonjs", "--moduleResolution", "node",
      "--target", "es2019", "--esModuleInterop", "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const seg = require(path.join(BUILD_DIR, "segments.js"));

  console.log("Runtime exports (compiled module):");
  for (const name of RUNTIME_EXPORTS) {
    check(`runtime export ${name}`, name in seg);
  }
  check(
    "SCORE_LAYERS value",
    JSON.stringify(seg.SCORE_LAYERS) ===
      JSON.stringify(["overall", "accessibility", "drainage", "shade"]),
  );

  console.log("getSegments():");
  const col = await seg.getSegments();
  check("FeatureCollection", col.type === "FeatureCollection");
  check(">= 40 features", col.features.length >= 40, `(${col.features.length})`);

  const SCORE_KEYS = ["score_overall", "score_accessibility", "score_drainage", "score_shade"];
  let badDistrict = 0, badAuditedAt = 0, badScores = 0, badDemo = 0, badGeom = 0;
  for (const f of col.features) {
    const p = f.properties;
    if (typeof p.district !== "string" || p.district.length === 0) badDistrict += 1;
    if (typeof p.audited_at !== "string" || p.audited_at.length === 0) badAuditedAt += 1;
    if (!SCORE_KEYS.every((k) => typeof p[k] === "number" && p[k] >= 0 && p[k] <= 100)) badScores += 1;
    if (p.demo !== true) badDemo += 1;
    if (f.geometry?.type !== "LineString" || f.geometry.coordinates.length < 2) badGeom += 1;
  }
  check("every feature has district", badDistrict === 0, badDistrict ? `(${badDistrict} missing)` : "");
  check("every feature has audited_at", badAuditedAt === 0, badAuditedAt ? `(${badAuditedAt} missing)` : "");
  check("every feature has all four score_* in 0..100", badScores === 0, badScores ? `(${badScores} bad)` : "");
  check("every feature demo=true", badDemo === 0);
  check("every geometry is a real LineString", badGeom === 0);

  console.log("getStats():");
  const stats = await seg.getStats();
  console.log(`  -> ${JSON.stringify(stats)}`);
  check(
    "shape {segments,km,coveragePct,heroPct} all numeric",
    ["segments", "km", "coveragePct", "heroPct"].every((k) => typeof stats[k] === "number"),
  );
  check("stats.segments matches collection", stats.segments === col.features.length);

  console.log("getSegmentDetail():");
  const first = col.features[0].properties.id;
  const detail = await seg.getSegmentDetail(first);
  check("returns detail for known id", Boolean(detail), `(${first})`);
  check("detail.district string", typeof detail?.district === "string" && detail.district.length > 0);
  check("detail.audited_at string", typeof detail?.audited_at === "string" && detail.audited_at.length > 0);
  check(
    "detail scores for all layers",
    Boolean(detail) && seg.SCORE_LAYERS.every((l) => typeof detail.scores[l] === "number"),
  );
  check(
    "detail has observations (static path)",
    (detail?.audit?.observations?.length ?? 0) > 0,
    `(${detail?.audit?.observations?.length ?? 0})`,
  );
  check("unknown id returns null", (await seg.getSegmentDetail("nope-does-not-exist")) === null);

  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nSMOKE FAIL — ${failures.length} failed check(s):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\nSMOKE PASS");
}

main().catch((err) => {
  console.error("[smoke] crashed:", err);
  process.exit(1);
});
