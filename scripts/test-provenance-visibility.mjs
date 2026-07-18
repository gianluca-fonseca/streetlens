#!/usr/bin/env node
/**
 * test-provenance-visibility.mjs (the unaudited signal beside the honest zero)
 *
 * getStats returns four SEALED audited figures (segments, km, coveragePct,
 * heroPct) that degrade to 0 with nothing published, plus three counters for
 * work that is real but not an audit: communitySegments, cvSessionsReviewed,
 * cvSegments. Those counters used to render nowhere on the public surfaces, so
 * an approved capture session looked like breakage ("still 0%").
 *
 * This locks the fix from both ends:
 *   1. Every `provenance` message formats correctly in EN and ES across the
 *      plural categories (1 vs many), via the same ICU engine next-intl uses.
 *   2. Every getStats consumer surface renders <ProvenanceNote>, and the
 *      component gates each line on its own counter being > 0.
 *   3. The audited figures are NOT touched: ProvenanceNote reads only the
 *      unaudited counters.
 *   4. `cvCoveragePct`, the number that MOVES when an approval lands, formats
 *      without ever rounding a real value away. One approved street is ~0.09% of
 *      the canton network, so a naive one-decimal render prints "0.0%" — the
 *      exact "nothing happened" that was reported as breakage. It must floor to
 *      "<0.1%" instead, and zero must produce no percentage at all.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { IntlMessageFormat } = require("intl-messageformat");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const messages = (loc) => JSON.parse(read(`messages/${loc}.json`)).provenance;

// ── 1. ICU formatting, both locales, both plural branches ────────────────────
console.log("provenance messages format in EN and ES");
for (const loc of ["en", "es"]) {
  const m = messages(loc);
  check(`${loc}: provenance block exists`, !!m && !!m.cv && !!m.community);
  if (!m) continue;

  const cvOne = new IntlMessageFormat(m.cv, loc).format({ segments: 1, sessions: 2 });
  const cvMany = new IntlMessageFormat(m.cv, loc).format({ segments: 3, sessions: 1 });
  const commOne = new IntlMessageFormat(m.community, loc).format({ count: 1 });
  const commMany = new IntlMessageFormat(m.community, loc).format({ count: 4 });

  // The owner's exact reported case: one CV street over two reviewed sessions.
  check(`${loc}: cv(1 street, 2 sessions) carries both counts`,
    cvOne.includes("1") && cvOne.includes("2"), JSON.stringify(cvOne));
  check(`${loc}: cv(3 streets, 1 session) carries both counts`,
    cvMany.includes("3") && cvMany.includes("1"), JSON.stringify(cvMany));
  check(`${loc}: cv singular and plural differ`, cvOne !== cvMany);
  check(`${loc}: community(1) vs community(4) differ`,
    commOne !== commMany && commOne.includes("1") && commMany.includes("4"),
    JSON.stringify([commOne, commMany]));
  // No raw ICU should survive formatting (an unbalanced brace would leak one).
  for (const [name, out] of [["cv", cvOne], ["community", commOne]]) {
    check(`${loc}: ${name} leaves no raw ICU`, !out.includes("{") && !out.includes("}"),
      JSON.stringify(out));
  }
}

// ── 2. Every getStats consumer surface renders the note ──────────────────────
console.log("");
console.log("every audited-stats surface renders <ProvenanceNote>");
const SURFACES = [
  "components/landing/Hero.tsx",
  "components/landing/PilotSection.tsx",
  "components/MapPanel.tsx",
];
for (const file of SURFACES) {
  const src = read(file);
  check(`${file} renders <ProvenanceNote`,
    src.includes("<ProvenanceNote") && src.includes('from "@/components/ProvenanceNote"'));
}

// ── 3. The component's own contract ──────────────────────────────────────────
console.log("");
console.log("ProvenanceNote gates on the unaudited counters only");
const note = read("components/ProvenanceNote.tsx");
check("cv line gated on cvSegments > 0", note.includes("stats.cvSegments > 0"));
check("community line gated on communitySegments > 0",
  note.includes("stats.communitySegments > 0"));
check("renders nothing when both counters are zero",
  note.includes("lines.length === 0") && note.includes("return null"));
// Comments are stripped first: the file's docblock NAMES the sealed figures to
// say it must never touch them, and that prose must not trip its own guard.
const noteCode = note.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// `stats.`-qualified on purpose: the unaudited `stats.cvCoveragePct` the CV line
// legitimately reads would trip a bare "coveragePct" substring guard.
for (const sealed of [
  "stats.heroPct",
  "stats.coveragePct",
  "stats.segments",
  "stats.km",
]) {
  check(`does not read the sealed audited figure ${sealed}`, !noteCode.includes(sealed));
}
check("does read the unaudited stats.cvCoveragePct",
  noteCode.includes("stats.cvCoveragePct"));

// ── 4. cvCoveragePct: the number that MOVES when an approval lands ───────────
console.log("");
console.log("camera-observed coverage formats without ever rounding away");

// Same CJS-compile harness test-cv-provenance.mjs uses for this module.
const BUILD_DIR = path.join(ROOT, ".test-build-provenance-visibility");
rmSync(BUILD_DIR, { recursive: true, force: true });
let formatCvCoveragePct;
try {
  execFileSync(
    "npx",
    ["tsc", "lib/cv-provenance.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs", "--moduleResolution", "node", "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict"],
    { cwd: ROOT, stdio: "inherit" },
  );
  ({ formatCvCoveragePct } = require(path.join(BUILD_DIR, "cv-provenance.js")));

  // THE regression: one approved street is ~0.09% of the canton network. Naive
  // one-decimal rounding prints "0.0%", which is the "nothing happened" the
  // owner reported as breakage on the one figure that is supposed to move.
  const tiny = formatCvCoveragePct(0.0938, "en");
  check("tiny nonzero floors to <0.1% (never 0.0%)",
    tiny === "<0.1%", JSON.stringify(tiny));
  check("tiny nonzero never renders a bare zero",
    !/(^|[^.\d])0\.0%/.test(tiny ?? ""), JSON.stringify(tiny));
  check("just under the floor still floors",
    formatCvCoveragePct(0.099, "en") === "<0.1%");
  check("exactly at the floor renders as a real value",
    formatCvCoveragePct(0.1, "en") === "0.1%");

  // A normal value keeps one decimal.
  check("normal value renders one decimal",
    formatCvCoveragePct(2.3, "en") === "2.3%",
    JSON.stringify(formatCvCoveragePct(2.3, "en")));
  check("normal value rounds to one decimal",
    formatCvCoveragePct(12.34, "en") === "12.3%",
    JSON.stringify(formatCvCoveragePct(12.34, "en")));

  // Zero (and junk) yields NO percentage fragment at all, so the caller falls
  // back to the count-only line rather than printing a hollow "0%".
  for (const [label, v] of [["zero", 0], ["negative", -1], ["NaN", NaN],
    ["undefined", undefined], ["null", null], ["a string", "2.3"]]) {
    check(`${label} yields no percentage fragment`,
      formatCvCoveragePct(v, "en") === null,
      JSON.stringify(formatCvCoveragePct(v, "en")));
  }

  // ES takes a comma decimal separator, floor included.
  check("es uses a comma decimal separator",
    formatCvCoveragePct(2.3, "es") === "2,3%",
    JSON.stringify(formatCvCoveragePct(2.3, "es")));
  check("es floors with a comma too",
    formatCvCoveragePct(0.0938, "es") === "<0,1%",
    JSON.stringify(formatCvCoveragePct(0.0938, "es")));
} finally {
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

// The percentage-bearing message exists and formats in both locales.
console.log("");
console.log("the cvWithCoverage message carries the percentage, EN and ES");
for (const loc of ["en", "es"]) {
  const m = messages(loc);
  check(`${loc}: cvWithCoverage exists`, !!m.cvWithCoverage);
  if (!m.cvWithCoverage) continue;
  const out = new IntlMessageFormat(m.cvWithCoverage, loc)
    .format({ segments: 1, sessions: 2, pct: "<0.1%" });
  check(`${loc}: carries counts and the percentage`,
    out.includes("1") && out.includes("2") && out.includes("<0.1%"),
    JSON.stringify(out));
  check(`${loc}: leaves no raw ICU`, !out.includes("{") && !out.includes("}"),
    JSON.stringify(out));
}

// The component picks the right message and floors through the shared formatter.
console.log("");
console.log("ProvenanceNote wires the percentage through the floor rule");
check("uses formatCvCoveragePct", note.includes("formatCvCoveragePct"));
check("imports it from the pure module",
  note.includes('from "@/lib/cv-provenance"'));
check("renders cvWithCoverage when a percentage exists",
  note.includes('t("cvWithCoverage"'));
check("falls back to the count-only cv line otherwise",
  note.includes('t("cv"'));

// getStats returns the field on EVERY path, demo era on or off.
console.log("");
console.log("getStats returns cvCoveragePct on every path");
const segmentsSrc = read("lib/segments.ts");
const returns = segmentsSrc.slice(segmentsSrc.indexOf("export async function getStats"));
const cvSegmentsReturns = (returns.match(/^\s*cvSegments,$/gm) ?? []).length;
const cvCoverageReturns = (returns.match(/^\s*cvCoveragePct,$/gm) ?? []).length;
check("every getStats return carrying cvSegments also carries cvCoveragePct",
  cvSegmentsReturns > 0 && cvCoverageReturns === cvSegmentsReturns,
  `cvSegments=${cvSegmentsReturns} cvCoveragePct=${cvCoverageReturns}`);
check("three return paths covered (live, demo-off, static)",
  cvCoverageReturns === 3, `got ${cvCoverageReturns}`);
// Lengths come from the full canton network, not the 535-segment audits file:
// a session walked outside the audited pilot must still move the number.
check("coverage is measured against the whole canton network",
  segmentsSrc.includes("NETWORK_SEGMENTS_PATH") &&
  segmentsSrc.includes('"segments.geojson"'));

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — the unaudited counters render on every stats surface, EN and ES");
