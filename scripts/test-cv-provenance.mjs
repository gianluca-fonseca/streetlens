#!/usr/bin/env node
/**
 * test-cv-provenance.mjs (segment provenance display)
 *
 * Locks the pure provenance formatting the CV popover and the admin header share:
 * friendly localized dates that are TIMEZONE-STABLE (the same UTC instant renders
 * the same calendar day everywhere), and a contact sanitizer that never linkifies
 * and never throws on the junk the maplibre boundary can hand back.
 *
 * Compiles the standalone lib/cv-provenance.ts to CJS (strict) and drives it,
 * exactly as test-parse-feature-props.mjs does. Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-cv-provenance");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/cv-provenance.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const P = require(path.join(BUILD_DIR, "cv-provenance.js"));

  // 1. Friendly localized dates, EN and ES, for the same instant.
  {
    const iso = "2026-07-15T02:00:00.000Z";
    check("EN date is long + localized", P.formatProvenanceDate(iso, "en") === "July 15, 2026", P.formatProvenanceDate(iso, "en"));
    check("ES date is long + localized", P.formatProvenanceDate(iso, "es") === "15 de julio de 2026", P.formatProvenanceDate(iso, "es"));
  }

  // 2. Timezone stability: an instant just after UTC midnight renders as that UTC
  // day regardless of the machine's local zone (the whole point of pinning UTC).
  {
    const iso = "2026-07-16T00:30:00.000Z";
    check("date is pinned to UTC (no local-zone day drift)", P.formatProvenanceDate(iso, "en") === "July 16, 2026", P.formatProvenanceDate(iso, "en"));
  }

  // 3. Absent / malformed dates degrade to null, never throw.
  {
    let threw = false;
    let results;
    try {
      results = [
        P.formatProvenanceDate(null, "en"),
        P.formatProvenanceDate(undefined, "en"),
        P.formatProvenanceDate("", "en"),
        P.formatProvenanceDate("   ", "en"),
        P.formatProvenanceDate("not a date", "en"),
        P.formatProvenanceDate(12345, "en"),
      ];
    } catch {
      threw = true;
    }
    check(
      "bad dates -> null, no throw",
      !threw && Array.isArray(results) && results.every((r) => r === null),
      JSON.stringify(results),
    );
  }

  // 4. Contact passthrough as given (may be an email; never linkified here).
  {
    check("email contact shown as given", P.sanitizeContact("walker@example.org") === "walker@example.org");
    check("named contact shown as given", P.sanitizeContact("Ana Solís") === "Ana Solís");
  }

  // 5. Whitespace collapsed and trimmed.
  {
    check("whitespace collapsed + trimmed", P.sanitizeContact("  ana   solis \n") === "ana solis", JSON.stringify(P.sanitizeContact("  ana   solis \n")));
  }

  // 6. Absent / non-string contact -> null (caller renders "Anonymous contributor").
  {
    let threw = false;
    let results;
    try {
      results = [
        P.sanitizeContact(null),
        P.sanitizeContact(undefined),
        P.sanitizeContact(""),
        P.sanitizeContact("   "),
        P.sanitizeContact(42),
        P.sanitizeContact({}),
      ];
    } catch {
      threw = true;
    }
    check(
      "no contact -> null, no throw",
      !threw && Array.isArray(results) && results.every((r) => r === null),
      JSON.stringify(results),
    );
  }

  // 7. A hostile mega-value is capped so it cannot blow out the compact line.
  {
    const out = P.sanitizeContact("x".repeat(500));
    check("oversized contact is capped", typeof out === "string" && out.length <= 80 && out.endsWith("…"), `len=${out.length}`);
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log("");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("PASS — cv-provenance formatting is locale-stable and junk-tolerant");
}

main();
