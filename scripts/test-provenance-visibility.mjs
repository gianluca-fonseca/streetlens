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
 *   3. The audited figures are NOT touched: ProvenanceNote reads only the three
 *      unaudited counters.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { readFileSync } from "node:fs";
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
for (const sealed of ["heroPct", "coveragePct", "stats.segments", "stats.km"]) {
  check(`does not read the sealed audited figure ${sealed}`, !noteCode.includes(sealed));
}

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — the unaudited counters render on every stats surface, EN and ES");
