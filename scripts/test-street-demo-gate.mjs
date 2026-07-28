#!/usr/bin/env node
/**
 * test-street-demo-gate.mjs — the demo switch, on the per-street surface.
 *
 * The map, the landing page and the stats were gated in wave 1; the street
 * report card was not, so with the switch OFF a visitor who deep-linked into a
 * street still read simulated accessibility, drainage, shade and bike scores
 * plus a simulated audit date and auditor. This suite locks the fix.
 *
 * It runs the real code, not a source scan: lib/segments.ts and
 * lib/street-card.ts are compiled to CJS (with the @/* alias resolved) and
 * called in both eras against a real pilot segment id read out of
 * data/demo-audits.json.
 *
 * What it asserts:
 *   - demo ON  → populated scores, the audit block, the audit date.
 *   - demo OFF → no score, no audit, no auditor label, no audit date.
 *   - the real OpenStreetMap facts (name, district, highway, length, geometry)
 *     are byte-identical across the two eras.
 *   - the orphaned-zero guard holds: hasAudit is never true without a figure
 *     behind it, and never false while one is being published.
 *   - a street with no audit is still a street: getStreetCard returns a card,
 *     not null (which the page turns into a 404).
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupIsolatedDataDir,
  cleanupIsolatedDataDir,
} from "./lib/test-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-street-gate");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const LAYERS = ["overall", "accessibility", "drainage", "shade", "bike"];
const scoreValues = (scores) => LAYERS.map((l) => scores[l]);

/** Every .js file under dir, recursively. */
function emittedFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return emittedFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

/**
 * tsc resolves the `@/*` alias for type-checking but emits the specifier
 * verbatim, so the compiled CJS would require("@/lib/segments") and die. Rewrite
 * each alias to a relative path inside the build dir. Small and mechanical, and
 * it is what lets this suite call the real getStreetCard rather than re-implement
 * its guard.
 */
function resolveAliasRequires(dir) {
  for (const file of emittedFiles(dir)) {
    const source = readFileSync(file, "utf8");
    const rewritten = source.replace(/require\("@\/([^"]+)"\)/g, (_m, target) => {
      let rel = path.relative(path.dirname(file), path.join(dir, target));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `require("${rel.split(path.sep).join("/")}")`;
    });
    if (rewritten !== source) writeFileSync(file, rewritten, "utf8");
  }
}

async function main() {
  const isolatedDir = setupIsolatedDataDir();

  try {
    // Static fallback path only: no Supabase env, so the demo files are the source.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    rmSync(BUILD_DIR, { recursive: true, force: true });
    // street-card.ts imports through the @/* alias, so this needs a real
    // tsconfig rather than tsc's bare CLI flags.
    const tsconfigPath = path.join(ROOT, ".test-tsconfig-street-gate.json");
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          outDir: path.relative(ROOT, BUILD_DIR),
          module: "commonjs",
          moduleResolution: "node",
          target: "es2020",
          esModuleInterop: true,
          skipLibCheck: true,
          strict: true,
          rootDir: ".",
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
        files: ["lib/segments.ts", "lib/street-card.ts"],
      }),
      "utf8",
    );
    try {
      execFileSync("npx", ["tsc", "-p", tsconfigPath], { cwd: ROOT, stdio: "inherit" });
    } finally {
      rmSync(tsconfigPath, { force: true });
    }
    resolveAliasRequires(BUILD_DIR);

    const segments = require(path.join(BUILD_DIR, "lib", "segments.js"));
    const streetCard = require(path.join(BUILD_DIR, "lib", "street-card.js"));

    // A real audited pilot segment, read out of the committed dataset rather
    // than hardcoded, so regenerating the demo data cannot quietly void this.
    const auditsFile = JSON.parse(
      readFileSync(path.join(ROOT, "data", "demo-audits.json"), "utf8"),
    );
    const pilotId = Object.keys(auditsFile.audits)[0];
    const audit = auditsFile.audits[pilotId];
    console.log(`pilot segment under test: ${pilotId}`);
    console.log("");

    console.log("getSegmentDetail — demo era ON");
    const on = await segments.getSegmentDetail(pilotId, true);
    check("returns the segment", on !== null && on.id === pilotId);
    check(
      "every lens carries a finite score",
      scoreValues(on.scores).every((v) => typeof v === "number" && Number.isFinite(v)),
      JSON.stringify(on.scores),
    );
    check(
      "at least one lens is a real figure",
      scoreValues(on.scores).some((v) => v > 0),
    );
    check("overall matches the dataset", on.scores.overall === audit.scores.overall);
    check("audit block present", on.audit !== null);
    check("auditor label present", (on.audit?.auditor ?? "").length > 0);
    check("audit date present", (on.audit?.audited_on ?? "").length > 0);
    check("observations present", (on.audit?.observations ?? []).length > 0);
    check("audited_at present", typeof on.audited_at === "string" && on.audited_at.length > 0);
    check("flagged demo", on.demo === true);

    console.log("");
    console.log("getSegmentDetail — demo era OFF");
    const off = await segments.getSegmentDetail(pilotId, false);
    check("still returns the segment (not a 404)", off !== null && off.id === pilotId);
    check(
      "no simulated score survives",
      scoreValues(off.scores).every((v) => v === 0),
      JSON.stringify(off.scores),
    );
    check("no audit block", off.audit === null);
    check("no audit date", off.audited_at === "");
    check("not flagged demo", off.demo === false);
    // The strongest form: nothing from the simulated audit is anywhere in the
    // payload, not just absent from the fields the page happens to read.
    const offWire = JSON.stringify(off);
    check("auditor label nowhere on the wire", !offWire.includes(audit.auditor));
    check("audit date nowhere on the wire", !offWire.includes(audit.audited_on));
    check(
      "rubric version nowhere on the wire",
      !offWire.includes(audit.rubric_version_id),
    );

    console.log("");
    console.log("real OpenStreetMap facts survive both eras");
    check("name", on.name === off.name && off.name.length > 0, off.name);
    check("district", on.district === off.district && off.district.length > 0, off.district);
    check("highway", on.highway === off.highway && off.highway === audit.highway, off.highway);
    check("length_m", on.length_m === off.length_m && off.length_m > 0, String(off.length_m));
    check(
      "geometry",
      JSON.stringify(on.geometry) === JSON.stringify(off.geometry) &&
        off.geometry.coordinates.length >= 2,
      `${off.geometry.coordinates.length} points`,
    );

    console.log("");
    console.log("street card — the orphaned-zero guard");
    const cardOn = await streetCard.getStreetCard(pilotId, "en", true);
    const cardOff = await streetCard.getStreetCard(pilotId, "en", false);
    check("card renders in the demo era", cardOn !== null);
    check("card still renders in the real-data era", cardOff !== null);
    check("demo era: hasAudit true", cardOn.hasAudit === true);
    check("real-data era: hasAudit false", cardOff.hasAudit === false);
    check(
      "real-data era: every score is zeroed behind the guard",
      scoreValues(cardOff.scores).every((v) => v === 0),
    );
    check("real-data era: no audited provenance line", !cardOff.provenance.some((p) => p.kind === "audited"));
    check("demo era: audited provenance line present", cardOn.provenance.some((p) => p.kind === "audited"));
    check("real-data era: street keeps its name", cardOff.name === cardOn.name);
    check("real-data era: demo caveat suppressed", cardOff.demo === false);

    // The guard is an invariant, not one lucky id: across a spread of the
    // pilot, hasAudit must be true exactly when a figure is being published.
    // A false hasAudit over a positive score would hide real data; a true
    // hasAudit over all zeros is the orphaned "0%" this whole unit exists to
    // kill.
    const sample = Object.keys(auditsFile.audits).slice(0, 25);
    let heldOn = 0;
    let heldOff = 0;
    for (const id of sample) {
      const [cOn, cOff] = await Promise.all([
        streetCard.getStreetCard(id, "en", true),
        streetCard.getStreetCard(id, "en", false),
      ]);
      const positive = (c) => c !== null && scoreValues(c.scores).some((v) => v > 0);
      if (cOn !== null && cOn.hasAudit === positive(cOn)) heldOn += 1;
      if (cOff !== null && cOff.hasAudit === false && !positive(cOff)) heldOff += 1;
    }
    check(
      `hasAudit tracks a published figure across ${sample.length} segments (demo on)`,
      heldOn === sample.length,
      `${heldOn}/${sample.length}`,
    );
    check(
      `no segment publishes a figure in the real-data era (${sample.length} sampled)`,
      heldOff === sample.length,
      `${heldOff}/${sample.length}`,
    );

    console.log("");
    console.log("unknown ids are still 404s");
    check(
      "getSegmentDetail(unknown)",
      (await segments.getSegmentDetail("nope-does-not-exist", true)) === null &&
        (await segments.getSegmentDetail("nope-does-not-exist", false)) === null,
    );
    check(
      "getStreetCard(unknown)",
      (await streetCard.getStreetCard("nope-does-not-exist", "en", false)) === null,
    );

    console.log("");
    console.log("the default argument keeps plain-Node callers working");
    process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = "true";
    const defaultOn = await segments.getSegmentDetail(pilotId);
    check("no-arg call honors the build-time default (on)", defaultOn.audit !== null);
    process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = "false";
    const defaultOff = await segments.getSegmentDetail(pilotId);
    check("no-arg call honors the build-time default (off)", defaultOff.audit === null);
    delete process.env.NEXT_PUBLIC_SHOW_DEMO_DATA;
  } finally {
    rmSync(BUILD_DIR, { recursive: true, force: true });
    cleanupIsolatedDataDir(isolatedDir);
  }

  console.log("");
  if (failures.length === 0) {
    console.log("PASS — the demo switch tells the truth on the street page");
    process.exit(0);
  }
  console.error(`FAIL — ${failures.length} check(s): ${failures.join(", ")}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
