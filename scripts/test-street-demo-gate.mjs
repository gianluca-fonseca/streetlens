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
 *
 * The last two sections were added at the wave-2 merge, where this gate met the
 * field notes. Neither branch could assert them alone: one had a card with no
 * notes on it, the other had notes with no gate under them. They lock the thing
 * the merge exists to prevent, which is a crew's prose surviving into an era the
 * same page says was never audited, on the card or on the click-time endpoint.
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

    /*
     * The merge collision, locked.
     *
     * Neither branch could write this alone. The demo gate was built against a
     * street card that carried five numbers; field notes were built against a
     * card with no gate. Together they make a failure worse than the orphaned
     * zero this suite already kills: a page that says in plain words that the
     * street has never been field-audited, with a crew's prose sitting under
     * it. A stray 0% is a bad reading. A stray field note is a false witness.
     *
     * Asserted on the serialized card, not on the fields the page happens to
     * read, and against the note text held in the data file, so a future change
     * that routes notes to the card by some other path still trips this.
     */
    console.log("");
    console.log("merge guard — no simulated field note survives the era flip");
    const notedId = Object.keys(auditsFile.audits).find((id) =>
      auditsFile.audits[id].observations.some(
        (o) =>
          (typeof o.note === "string" && o.note.trim().length > 0) ||
          (typeof o.note_en === "string" && o.note_en.trim().length > 0),
      ),
    );
    check("the dataset still carries at least one field note", Boolean(notedId), notedId ?? "");
    const notedAudit = auditsFile.audits[notedId];
    const noteTexts = notedAudit.observations.flatMap((o) =>
      [o.note, o.note_en].filter((v) => typeof v === "string" && v.trim().length > 0),
    );

    for (const locale of ["en", "es"]) {
      const notedOn = await streetCard.getStreetCard(notedId, locale, true);
      const notedOff = await streetCard.getStreetCard(notedId, locale, false);

      check(
        `${locale}: demo era publishes the crew's observations`,
        notedOn.observations.length > 0 &&
          notedOn.observations.some((o) => o.note !== null),
        `(${notedOn.observations.filter((o) => o.note !== null).length} noted)`,
      );
      check(
        `${locale}: demo era attributes them to a crew label`,
        typeof notedOn.auditor === "string" && notedOn.auditor.length > 0,
      );

      check(
        `${locale}: real-data era publishes no observation at all`,
        notedOff.observations.length === 0,
        `(${notedOff.observations.length})`,
      );
      check(`${locale}: real-data era carries no crew label`, notedOff.auditor === null);
      // The card renders its observations section only when hasAudit is also
      // true, so this is the render gate's premise as well as the data's.
      check(`${locale}: real-data era hasAudit false`, notedOff.hasAudit === false);

      const offCardWire = JSON.stringify(notedOff);
      const leaked = noteTexts.filter((n) => offCardWire.includes(n));
      check(
        `${locale}: no note text anywhere on the real-data-era card`,
        leaked.length === 0,
        `(${noteTexts.length} checked)`,
      );
    }

    // An observation may never outlive the audit that authorises it. This is
    // the coupling the card's `hasAudit && observationGroups.length > 0` render
    // gate states, asserted on the data so the two cannot drift apart.
    let coupled = 0;
    for (const id of sample) {
      const [cOn, cOff] = await Promise.all([
        streetCard.getStreetCard(id, "en", true),
        streetCard.getStreetCard(id, "en", false),
      ]);
      const ok = (c) => c === null || c.observations.length === 0 || c.hasAudit === true;
      if (ok(cOn) && ok(cOff) && cOff.observations.length === 0) coupled += 1;
    }
    check(
      `an observation never outlives hasAudit, and never the demo era (${sample.length} sampled)`,
      coupled === sample.length,
      `${coupled}/${sample.length}`,
    );

    /*
     * The detail route is the one surface where the two branches genuinely
     * disagreed. It is CDN-cached and was deliberately left on the build-time
     * default while it was an existence check; it now serves the audit body, so
     * it resolves the era per request instead. This asserts the composition the
     * route performs (cookie -> resolveDemoData -> getSegmentDetail) rather than
     * booting Next, plus the wiring itself, because the regression to guard
     * against is precisely someone restoring the bare default call.
     */
    console.log("");
    console.log("merge guard — the detail route resolves the era it serves");
    const demoFlag = require(path.join(BUILD_DIR, "lib", "demo-flag.js"));
    const viaCookieOff = await segments.getSegmentDetail(
      notedId,
      demoFlag.resolveDemoData(demoFlag.DEMO_DATA_OFF),
    );
    const viaCookieOn = await segments.getSegmentDetail(
      notedId,
      demoFlag.resolveDemoData(demoFlag.DEMO_DATA_ON),
    );
    check("cookie 'off' serves no audit body", viaCookieOff.audit === null);
    check("cookie 'on' serves the audit body", viaCookieOn.audit !== null);
    check(
      "cookie 'off' body carries no note text",
      noteTexts.every((n) => !JSON.stringify(viaCookieOff).includes(n)),
    );
    const routeSource = readFileSync(
      path.join(ROOT, "app", "api", "segments", "[id]", "detail", "route.ts"),
      "utf8",
    );
    check(
      "route passes a resolved era to getSegmentDetail",
      /getSegmentDetail\(id,\s*demoEnabled\)/.test(routeSource) &&
        !/getSegmentDetail\(id\)/.test(routeSource),
    );
    check(
      "route varies on Cookie so a shared cache cannot cross the eras",
      /Vary:\s*"Cookie"/.test(routeSource),
    );
    check(
      "an explicit override is never written to a shared cache",
      /private,\s*no-store/.test(routeSource),
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
