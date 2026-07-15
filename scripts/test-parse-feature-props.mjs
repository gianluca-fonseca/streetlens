#!/usr/bin/env node
/**
 * test-parse-feature-props.mjs (u7c crash fix)
 *
 * Locks the maplibre-serialization crash fix: the detail panel must never throw
 * on the report fields maplibre-gl hands back as JSON strings. Compiles the pure
 * lib/parse-feature-props.ts to CJS (strict) and drives it directly.
 *
 * Cases: object passthrough, stringified report, stringified "[]", stringified
 * array with entries, malformed JSON, missing created_at. Exits 0 on PASS,
 * 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-parse-props");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function report(id, extra = {}) {
  return {
    id,
    segment_id: "esc-sa-0163",
    note: `note ${id}`,
    submission_id: null,
    created_at: "2026-07-15T02:00:00.000Z",
    ...extra,
  };
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/parse-feature-props.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const P = require(path.join(BUILD_DIR, "parse-feature-props.js"));

  // 1. Object passthrough — a real report object survives intact.
  {
    const r = report("rep-obj");
    const out = P.parseCommunityReport(r);
    check("object report passthrough", out && out.id === "rep-obj", JSON.stringify(out));
  }

  // 2. Stringified single report (maplibre worker boundary) → parsed object.
  {
    const r = report("rep-str");
    const out = P.parseCommunityReport(JSON.stringify(r));
    check(
      "stringified report parsed",
      out && out.id === "rep-str" && out.note === "note rep-str",
      JSON.stringify(out),
    );
  }

  // 3. Stringified empty array "[]" → empty array, no throw, no spread-to-chars.
  {
    const out = P.parseCommunityReports("[]");
    check("stringified [] -> empty array", Array.isArray(out) && out.length === 0);
  }

  // 4. Stringified array WITH entries → array of report objects.
  {
    const arr = [report("rep-a"), report("rep-b")];
    const out = P.parseCommunityReports(JSON.stringify(arr));
    check(
      "stringified array with entries parsed",
      Array.isArray(out) && out.length === 2 && out[0].id === "rep-a" && out[1].id === "rep-b",
      JSON.stringify(out),
    );
  }

  // 5. Malformed JSON → safe defaults (null report, empty array), never throws.
  {
    let threw = false;
    let single, list;
    try {
      single = P.parseCommunityReport("{not json");
      list = P.parseCommunityReports("[not json");
    } catch {
      threw = true;
    }
    check(
      "malformed JSON -> safe defaults, no throw",
      !threw && single === null && Array.isArray(list) && list.length === 0,
      `single=${JSON.stringify(single)} list=${JSON.stringify(list)}`,
    );
  }

  // 6. Missing created_at → still a valid report (kept; rendered without a date).
  {
    const noDate = report("rep-nodate");
    delete noDate.created_at;
    const single = P.parseCommunityReport(noDate);
    const list = P.parseCommunityReports([noDate]);
    check(
      "report missing created_at kept as valid",
      single && single.id === "rep-nodate" && single.created_at === undefined &&
        list.length === 1 && list[0].id === "rep-nodate",
      JSON.stringify(single),
    );
  }

  // 7. Full feature-props normalization: stringified fields on raw properties.
  {
    const raw = {
      id: "com-abc",
      name: "Calle Comunitaria",
      source: "community",
      verified: false,
      community_report: JSON.stringify(report("rep-embed")),
      community_reports: "[]",
    };
    const out = P.parseFeatureProps(raw);
    check(
      "parseFeatureProps normalizes stringified fields",
      out.id === "com-abc" &&
        out.community_report && out.community_report.id === "rep-embed" &&
        Array.isArray(out.community_reports) && out.community_reports.length === 0,
      JSON.stringify(out.community_report),
    );
  }

  // 8. Null / "null" / non-report junk → null report, empty reports.
  {
    check(
      "null and junk collapse to safe defaults",
      P.parseCommunityReport(null) === null &&
        P.parseCommunityReport("null") === null &&
        P.parseCommunityReport(42) === null &&
        P.parseCommunityReports(null).length === 0 &&
        P.parseCommunityReports({}).length === 0 &&
        // an array element lacking an id is dropped, not kept as junk
        P.parseCommunityReports([{ note: "no id" }]).length === 0,
    );
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nPASS: all parse-feature-props checks green");
}

main();
