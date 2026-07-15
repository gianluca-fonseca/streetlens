#!/usr/bin/env node
/**
 * test-import-dryrun.mjs (advisor verification bar, u7)
 *
 * Exercises the bulk-import DRY RUN (lib/import-pipeline, pure):
 *   - a valid GeoJSON/CSV file → correct preview counts;
 *   - invalid rows → per-row errors (schema / duplicate / bbox);
 *   - ZERO side effects (no community local file is ever written).
 *
 * Compiles lib/import-pipeline.ts to CJS (strict) and drives it directly. Exits
 * 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-dryrun");
const DATA = path.join(ROOT, "data");
const require = createRequire(import.meta.url);

const SIDE_EFFECT_FILES = [
  path.join(DATA, "community-segments.local.json"),
  path.join(DATA, "community-reports.local.json"),
];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  for (const f of SIDE_EFFECT_FILES) {
    if (existsSync(f)) throw new Error(`refusing to run: ${path.basename(f)} exists`);
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/import-pipeline.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const P = require(path.join(BUILD_DIR, "import-pipeline.js"));

  // --- GeoJSON: 2 valid (one out-of-bbox), 1 invalid highway, 1 duplicate id.
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Calle A", highway: "residential" },
        geometry: { type: "LineString", coordinates: [[-84.14, 9.912], [-84.139, 9.913]] },
      },
      {
        // valid schema but OUTSIDE the Escazú bbox (still in Costa Rica).
        type: "Feature",
        properties: { name: "Calle lejana", highway: "residential" },
        geometry: { type: "LineString", coordinates: [[-84.0, 9.95], [-83.99, 9.96]] },
      },
      {
        // invalid: highway not in the enum.
        type: "Feature",
        properties: { name: "Calle mala", highway: "motorway" },
        geometry: { type: "LineString", coordinates: [[-84.14, 9.912], [-84.139, 9.913]] },
      },
      {
        // duplicate id vs an existing segment.
        type: "Feature",
        properties: { id: "esc-sa-0001", name: "Calle dup", highway: "residential" },
        geometry: { type: "LineString", coordinates: [[-84.14, 9.912], [-84.139, 9.913]] },
      },
    ],
  };
  const existing = new Set(["esc-sa-0001"]);

  const raw = P.parseFile(JSON.stringify(fc), "sample.geojson");
  check("GeoJSON parsed 4 features", Array.isArray(raw) && raw.length === 4, `(${raw?.length})`);
  const evald = P.evaluateFeatures(raw, existing);
  const rows = evald.map((e) => e.row);
  const summary = P.summarize(rows);
  console.log(`  -> summary ${JSON.stringify(summary)}`);

  check("summary.total = 4", summary.total === 4);
  check("summary.valid = 2", summary.valid === 2, `(${summary.valid})`);
  check("summary.invalid = 1", summary.invalid === 1, `(${summary.invalid})`);
  check("summary.duplicate = 1", summary.duplicate === 1, `(${summary.duplicate})`);
  check("summary.outOfBounds = 1", summary.outOfBounds === 1, `(${summary.outOfBounds})`);

  check("row 0 valid, no issues", rows[0].status === "valid" && rows[0].issues.length === 0);
  check("row 1 valid + bbox issue", rows[1].status === "valid" && rows[1].issues.some((i) => i.code === "bbox"));
  check("row 2 invalid + schema issue", rows[2].status === "invalid" && rows[2].issues.some((i) => i.code === "schema"));
  check("row 3 duplicate + duplicate issue", rows[3].status === "duplicate" && rows[3].issues.some((i) => i.code === "duplicate"));
  check(
    "commit-eligible features = valid rows only (2)",
    evald.filter((e) => e.feature !== null).length === 2,
  );

  // --- CSV parsing path.
  const csv = [
    "name,highway,coordinates",
    "Calle CSV,residential,-84.14 9.912;-84.139 9.913",
    "Bad CSV,notatype,-84.14 9.912;-84.139 9.913",
  ].join("\n");
  const csvRaw = P.parseFile(csv, "sample.csv");
  check("CSV parsed 2 rows", Array.isArray(csvRaw) && csvRaw.length === 2, `(${csvRaw?.length})`);
  const csvRows = P.evaluateFeatures(csvRaw, new Set()).map((e) => e.row);
  check("CSV row 0 valid", csvRows[0].status === "valid");
  check("CSV row 1 invalid (bad highway)", csvRows[1].status === "invalid");

  // --- Unparseable file → null.
  check("garbage file → parseFile null", P.parseFile("this is not json or csv", "x.txt") === null);

  // --- No side effects: the dry run never touched the community store.
  const wrote = SIDE_EFFECT_FILES.filter((f) => existsSync(f));
  check("ZERO side effects (no community file written)", wrote.length === 0, wrote.join(", "));

  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nDRYRUN-TEST FAIL — ${failures.length}:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\nDRYRUN-TEST PASS");
}

try {
  main();
} catch (err) {
  console.error("[test-dryrun] crashed:", err);
  process.exit(1);
}
