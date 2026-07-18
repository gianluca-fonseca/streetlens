#!/usr/bin/env node
/**
 * smoke-adapter.mjs
 *
 * End-to-end smoke test of the static-fallback data adapter plus a contract
 * check of lib/segments.ts's frozen export surface (advisor rev 4).
 *
 * - Compiles lib/{types,supabase,demo-flag,segments}.ts to CJS in .smoke-build/
 *   and exercises getSegments / getSegmentDetail / getStats with no Supabase env.
 * - With demo data ON (NEXT_PUBLIC_SHOW_DEMO_DATA=true): asserts every audited
 *   feature carries district, audited_at, all five score_* fields, and demo:true.
 * - With demo data OFF (the default): asserts the generated pilot scores are
 *   hidden — the 535 esc-sa features re-cast as the neutral canton overlay and
 *   the audited stat figures degrade to zero.
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
import {
  setupIsolatedDataDir,
  cleanupIsolatedDataDir,
  localDataPath,
} from "./lib/test-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".smoke-build");
const COMMUNITY_SEGMENTS_NAME = "community-segments.local.json";
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
  const isolatedDir = setupIsolatedDataDir();
  const COMMUNITY_SEGMENTS_PATH = localDataPath(COMMUNITY_SEGMENTS_NAME);

  try {
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
      "tsc", "lib/types.ts", "lib/supabase.ts", "lib/demo-flag.ts", "lib/segments.ts",
      "--outDir", BUILD_DIR, "--module", "commonjs", "--moduleResolution", "node",
      "--target", "es2019", "--esModuleInterop", "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  // The demo-on assertions below are the legacy behavior, now gated behind the
  // flag. Set it explicitly so this suite exercises the preserved demo path;
  // showDemoData() reads process.env at call time, so a later delete flips it off
  // for the demo-off scenario without reloading the module.
  process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = "true";

  const seg = require(path.join(BUILD_DIR, "segments.js"));

  console.log("Runtime exports (compiled module):");
  for (const name of RUNTIME_EXPORTS) {
    check(`runtime export ${name}`, name in seg);
  }
  check(
    "SCORE_LAYERS value",
    JSON.stringify(seg.SCORE_LAYERS) ===
      JSON.stringify(["overall", "accessibility", "drainage", "shade", "bike"]),
  );

  // The unaudited canton overlay (esc-ce/esc-sr) merges into getSegments as
  // source:"import" neutral features. Count it so the audited pilot (535) and
  // the neutral overlay are asserted separately.
  const importFile = path.join(ROOT, "data", "canton-import-segments.json");
  const importCount = existsSync(importFile)
    ? JSON.parse(await fs.readFile(importFile, "utf8")).length
    : 0;
  const AUDITED = 535;

  console.log("getSegments():");
  const col = await seg.getSegments();
  check("FeatureCollection", col.type === "FeatureCollection");
  check(">= 40 features", col.features.length >= 40, `(${col.features.length})`);
  // Audited pilot features carry no `source`; the canton overlay carries "import".
  const audited = col.features.filter((f) => !f.properties.source);
  const neutral = col.features.filter((f) => f.properties.source);
  check("exactly 535 audited features", audited.length === AUDITED, `(${audited.length})`);
  check(
    "collection = 535 audited + canton import overlay",
    col.features.length === AUDITED + importCount,
    `(${col.features.length} = 535 + ${importCount})`,
  );

  const SCORE_KEYS = ["score_overall", "score_accessibility", "score_drainage", "score_shade", "score_bike"];
  let badDistrict = 0, badAuditedAt = 0, badScores = 0, badDemo = 0, badGeom = 0;
  for (const f of audited) {
    const p = f.properties;
    if (typeof p.district !== "string" || p.district.length === 0) badDistrict += 1;
    if (typeof p.audited_at !== "string" || p.audited_at.length === 0) badAuditedAt += 1;
    if (!SCORE_KEYS.every((k) => typeof p[k] === "number" && p[k] >= 0 && p[k] <= 100)) badScores += 1;
    if (p.demo !== true) badDemo += 1;
    if (f.geometry?.type !== "LineString" || f.geometry.coordinates.length < 2) badGeom += 1;
  }
  check("every audited feature has district", badDistrict === 0, badDistrict ? `(${badDistrict} missing)` : "");
  check("every audited feature has audited_at", badAuditedAt === 0, badAuditedAt ? `(${badAuditedAt} missing)` : "");
  check("every audited feature has all five score_* in 0..100 (incl. score_bike)", badScores === 0, badScores ? `(${badScores} bad)` : "");
  check("every audited feature demo=true", badDemo === 0);
  check("every audited geometry is a real LineString", badGeom === 0);

  // The canton overlay must render neutral: import source, no scores, real geometry.
  let badNeutralSource = 0, badNeutralScore = 0, badNeutralGeom = 0;
  for (const f of neutral) {
    const p = f.properties;
    if (p.source !== "import" && p.source !== "community") badNeutralSource += 1;
    if (!SCORE_KEYS.every((k) => p[k] === 0)) badNeutralScore += 1;
    if (f.geometry?.type !== "LineString" || f.geometry.coordinates.length < 2) badNeutralGeom += 1;
  }
  check("canton overlay present", neutral.length === importCount, `(${neutral.length} of ${importCount})`);
  check("every overlay feature is source import/community", badNeutralSource === 0);
  check("every overlay feature carries NO score (all 0, never a ramp color)", badNeutralScore === 0);
  check("every overlay geometry is a real LineString", badNeutralGeom === 0);

  console.log("getStats():");
  const stats = await seg.getStats();
  console.log(`  -> ${JSON.stringify(stats)}`);
  check(
    "shape {segments,km,coveragePct,heroPct} all numeric",
    ["segments", "km", "coveragePct", "heroPct"].every((k) => typeof stats[k] === "number"),
  );
  check("stats.segments is the audited pilot only (535)", stats.segments === AUDITED, `(${stats.segments})`);
  check(
    "stats.communitySegments is numeric (contract v3)",
    typeof stats.communitySegments === "number",
  );
  // communitySegments is the CONTRIBUTION counter (community adds), not the
  // committed canton overlay — so it stays 0 with no community store.
  check(
    "stats.communitySegments is 0 with no community store (overlay is not a contribution)",
    stats.communitySegments === 0,
    `(${stats.communitySegments})`,
  );

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

  // 3. Community-exclusion scenario (contract v3): with a community store present,
  // community/import segments merge into getSegments but are EXCLUDED from the
  // official 535 stat and counted under communitySegments instead.
  console.log("community store merged in:");
  const fixture = [
    {
      id: "com-smoke-1",
      name: "SMOKE — community add",
      highway: "residential",
      district: "Escazú",
      source: "community",
      verified: false,
      auditor: null,
      submission_id: "smoke-1",
      coordinates: [[-84.14, 9.912], [-84.139, 9.913]],
      community_report: null,
      created_at: "2026-07-14T00:00:00.000Z",
    },
    {
      id: "imp-smoke-2",
      name: "SMOKE — verified import",
      highway: "tertiary",
      district: "Escazú",
      source: "import",
      verified: true,
      auditor: "Smoke Auditor",
      submission_id: null,
      coordinates: [[-84.14, 9.912], [-84.138, 9.914]],
      community_report: null,
      created_at: "2026-07-14T00:00:00.000Z",
    },
  ];
  try {
    await fs.writeFile(COMMUNITY_SEGMENTS_PATH, JSON.stringify(fixture, null, 2), "utf8");
    const merged = await seg.getSegments();
    const mergedStats = await seg.getStats();
    check(
      "merged collection = 535 audited + canton overlay + 2 community",
      merged.features.length === AUDITED + importCount + 2,
      `(${merged.features.length})`,
    );
    check("official stats.segments STILL 535 (community/import excluded)", mergedStats.segments === AUDITED, `(${mergedStats.segments})`);
    check(
      "stats.communitySegments counts the 2 community adds (not the baseline overlay)",
      mergedStats.communitySegments === 2,
      `(${mergedStats.communitySegments})`,
    );
    const c1 = merged.features.find((f) => f.properties.id === "com-smoke-1");
    check("community feature flagged source/verified", Boolean(c1) && c1.properties.source === "community" && c1.properties.verified === false);
    check(
      "community feature has NO scores",
      Boolean(c1) &&
        [c1.properties.score_overall, c1.properties.score_accessibility, c1.properties.score_drainage, c1.properties.score_shade, c1.properties.score_bike].every((s) => s === 0),
    );
    check(
      "audited features carry no source flag (pilot stays 535)",
      merged.features.filter((f) => !f.properties.source).length === AUDITED,
    );
  } finally {
    await fs.rm(COMMUNITY_SEGMENTS_PATH, { force: true });
  }

  // 4. Demo era OFF (the default): NEXT_PUBLIC_SHOW_DEMO_DATA unset must hide
  // every generated pilot score. The 535 esc-sa features re-cast as the neutral
  // unaudited network (source:"import", scores zeroed), so NO ramp/audited
  // feature survives and the audited stat figures degrade to zero. Real
  // community/CV data is unaffected (none present here → all zero counters).
  console.log("demo data OFF (default):");
  delete process.env.NEXT_PUBLIC_SHOW_DEMO_DATA;
  const offCol = await seg.getSegments();
  const offStats = await seg.getStats();
  console.log(`  -> ${JSON.stringify(offStats)}`);
  const offRamp = offCol.features.filter((f) => !f.properties.source);
  const offFormerDemo = offCol.features.filter((f) => f.properties.source === "import");
  check(
    "collection size unchanged (535 pilot + canton overlay)",
    offCol.features.length === AUDITED + importCount,
    `(${offCol.features.length})`,
  );
  check("NO ramp/audited feature survives (nothing carries a demo score)", offRamp.length === 0, `(${offRamp.length})`);
  let offBadScore = 0, offBadDemo = 0;
  for (const f of offFormerDemo) {
    const p = f.properties;
    if (!SCORE_KEYS.every((k) => p[k] === 0)) offBadScore += 1;
    if (p.demo !== false) offBadDemo += 1;
  }
  check("every visible feature carries NO score (all 0)", offBadScore === 0, offBadScore ? `(${offBadScore} bad)` : "");
  check("no feature is flagged demo=true", offBadDemo === 0, offBadDemo ? `(${offBadDemo} bad)` : "");
  check("stats.segments degrades to 0 (no audited data published)", offStats.segments === 0, `(${offStats.segments})`);
  check("stats.km degrades to 0", offStats.km === 0, `(${offStats.km})`);
  check("stats.coveragePct degrades to 0", offStats.coveragePct === 0, `(${offStats.coveragePct})`);
  check("stats.heroPct degrades to 0", offStats.heroPct === 0, `(${offStats.heroPct})`);
  check(
    "real counters stay numeric (community/CV unaffected)",
    ["communitySegments", "cvSessionsReviewed", "cvSegments"].every((k) => typeof offStats[k] === "number"),
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nSMOKE FAIL — ${failures.length} failed check(s):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\nSMOKE PASS");
  } finally {
    cleanupIsolatedDataDir(isolatedDir);
  }
}

main().catch((err) => {
  console.error("[smoke] crashed:", err);
  process.exit(1);
});
