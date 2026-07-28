#!/usr/bin/env node
/**
 * test-demo-audits.mjs (bgsd-0018 demo-ready)
 *
 * Locks `data/demo-audits.json` against the two ways a demo dataset embarrasses
 * you in front of a stakeholder.
 *
 * 1. INCONSISTENCY. Someone clicks a segment showing 40 accessibility and reads
 *    the observations under it, and they do not add up to 40. So every published
 *    score is re-derived here from the published responses through the REAL
 *    rollup — `lensScoresFromItems` compiled out of lib/capture/scoring.ts, not
 *    a copy of it. If the generator's mirror of that function ever drifts, this
 *    fails.
 *
 * 2. THE SYNTHETIC TELLS. One audit date for 535 segments, one auditor string,
 *    zero notes, 31 photos, and scores far too flattering for Costa Rica. Each
 *    of those is a band below.
 *
 * Also asserts the honesty constraints that outrank realism: the file says it is
 * simulated, and no auditor label may read as a personal name. Simulated audits
 * must never look attributable to a real surveyor.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-demo-audits");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function share(values, predicate) {
  return values.filter(predicate).length / values.length;
}

/** Compile the real rollup so the consistency check binds to lib/, not a copy. */
function compileScoring() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        rootDir: "../lib",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2022",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: ["../lib/capture/scoring.ts", "../lib/capture/types.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
  return require(path.join(BUILD_DIR, "capture", "scoring.js"));
}

function main() {
  const S = compileScoring();

  const file = JSON.parse(
    readFileSync(path.join(ROOT, "data", "demo-audits.json"), "utf8"),
  );
  const entries = Object.entries(file.audits);
  const audits = entries.map(([, a]) => a);
  const observations = audits.flatMap((a) => a.observations);

  /* ---------------- Provenance: generated, seeded, honest ---------------- */
  console.log("\nprovenance");
  {
    check("demo: true", file.demo === true);
    check("simulated: true — the data says so, not just the banner", file.simulated === true);
    check(
      "the honesty note names the dataset as simulated",
      typeof file.note === "string" && /simulated/i.test(file.note),
      file.note ? "" : "(missing)",
    );
    check(
      "the generator is named in the header block",
      file.generator === "scripts/generate-demo-audits.mjs",
      `${file.generator}`,
    );
    check(
      "the PRNG seed is recorded in the header block",
      Number.isInteger(file.seed),
      `${file.seed}`,
    );
    check("rubric version is v0.1", file.rubric_version_id === "v0.1");
    check("535 pilot segments", audits.length === 535, `${audits.length}`);
    check(
      "every audit id is an esc-sa-* pilot segment",
      entries.every(([id]) => id.startsWith("esc-sa-")),
    );
  }

  /* ---------------- The committed file IS the script's output ---------------- */
  console.log("\ndeterminism");
  {
    // Regenerates in memory and diffs. Catches both a non-deterministic
    // generator and a hand-edited JSON file, which are the two ways this data
    // stops being reproducible.
    let ok = true;
    let detail = "";
    try {
      execFileSync(
        "node",
        [path.join(__dirname, "generate-demo-audits.mjs"), "--check"],
        { cwd: ROOT, stdio: "pipe" },
      );
    } catch (err) {
      ok = false;
      detail = String(err.stderr ?? err.message).trim().split("\n").pop() ?? "";
    }
    check(
      "re-running the generator reproduces every committed artifact byte for byte",
      ok,
      detail,
    );
  }

  /* ---------------- Score <-> observation consistency ---------------- */
  console.log("\nscore <-> observation consistency (via lib/capture/scoring.ts)");
  {
    const mismatches = [];
    for (const [id, audit] of entries) {
      const normalized = {};
      for (const obs of audit.observations) normalized[obs.item_key] = obs.response;
      const rolled = S.lensScoresFromItems(normalized);
      for (const lens of ["overall", "accessibility", "drainage", "shade", "bike"]) {
        if (Math.round(rolled[lens]) !== audit.scores[lens]) {
          mismatches.push(`${id}.${lens}: published ${audit.scores[lens]}, rolls up to ${rolled[lens]}`);
        }
      }
    }
    check(
      "every published lens score is what its observations actually roll up to",
      mismatches.length === 0,
      mismatches.length ? `\n    ${mismatches.slice(0, 5).join("\n    ")}` : "",
    );

    check(
      "every observation carries all 15 rubric items",
      audits.every((a) => a.observations.length === 15),
    );
    check(
      "every response is normalized into 0..1",
      observations.every((o) => o.response >= 0 && o.response <= 1),
    );
  }

  /* ---------------- The map file agrees with the audit file ---------------- */
  console.log("\ndemo-segments.geojson agrees with demo-audits.json");
  {
    const collection = JSON.parse(
      readFileSync(path.join(ROOT, "data", "demo-segments.geojson"), "utf8"),
    );
    const drift = [];
    for (const feature of collection.features) {
      const audit = file.audits[feature.properties.id];
      if (!audit) {
        drift.push(`${feature.properties.id} has no audit`);
        continue;
      }
      for (const lens of ["overall", "accessibility", "drainage", "shade", "bike"]) {
        if (feature.properties[`score_${lens}`] !== audit.scores[lens]) {
          drift.push(`${feature.properties.id}.${lens}`);
        }
      }
      if (feature.properties.audited_at !== audit.audited_on) {
        drift.push(`${feature.properties.id}.audited_at`);
      }
    }
    check(
      "the map's scores and audit dates match the detail panel's",
      drift.length === 0,
      drift.length ? `${drift.length} mismatches, e.g. ${drift.slice(0, 3).join(", ")}` : "",
    );
  }

  /* ---------------- Calibration: Costa Rica, not a flattering demo ---------------- */
  console.log("\ncalibration");
  {
    const lens = (key) => audits.map((a) => a.scores[key]);

    const bike = lens("bike");
    check("bike median <= 15 (near-hostile for cyclists)", median(bike) <= 15, `${median(bike)}`);
    check(
      "at least 70% of segments score 0-15 for bike",
      share(bike, (v) => v <= 15) >= 0.7,
      `${(share(bike, (v) => v <= 15) * 100).toFixed(0)}%`,
    );
    check(
      "a handful of painted-shoulder outliers reach 30-45, and nothing beyond",
      bike.some((v) => v >= 30) && Math.max(...bike) <= 45,
      `max ${Math.max(...bike)}`,
    );

    const access = lens("accessibility");
    check(
      "accessibility median in 30-48",
      median(access) >= 30 && median(access) <= 48,
      `${median(access)}`,
    );
    check(
      "a real share of segments have no usable sidewalk (accessibility < 20)",
      share(access, (v) => v < 20) >= 0.1,
      `${(share(access, (v) => v < 20) * 100).toFixed(0)}%`,
    );

    const drainage = lens("drainage");
    check(
      "drainage median in 45-65",
      median(drainage) >= 45 && median(drainage) <= 65,
      `${median(drainage)}`,
    );

    const shade = lens("shade");
    check(
      "shade median in 55-70 (canopy is genuinely variable)",
      median(shade) >= 55 && median(shade) <= 70,
      `${median(shade)}`,
    );

    const overall = lens("overall");
    check(
      "overall median in 40-58",
      median(overall) >= 40 && median(overall) <= 58,
      `${median(overall)}`,
    );

    // Spread, not a flat shift: a constant offset would pass the medians above.
    for (const [key, values] of [
      ["accessibility", access],
      ["drainage", drainage],
      ["shade", shade],
      ["overall", overall],
    ]) {
      check(
        `${key} has believable spread, not one repeated value`,
        new Set(values).size >= 8,
        `${new Set(values).size} distinct values`,
      );
    }

    // Road class has to matter, or every street is the same street.
    const byClass = (highway, key) =>
      audits.filter((a) => a.highway === highway).map((a) => a.scores[key]);
    check(
      "secondary roads read differently from residential ones",
      median(byClass("secondary", "accessibility")) !==
        median(byClass("residential", "accessibility")) ||
        median(byClass("secondary", "bike")) !== median(byClass("residential", "bike")),
      `secondary acc ${median(byClass("secondary", "accessibility"))} / residential acc ${median(byClass("residential", "accessibility"))}`,
    );
  }

  /* ---------------- Fieldwork realism ---------------- */
  console.log("\nfieldwork realism");
  {
    const dates = audits.map((a) => a.audited_on);
    const distinctDates = [...new Set(dates)].sort();
    check(
      "audit dates spread across at least 10 field days",
      distinctDates.length >= 10,
      `${distinctDates.length} days`,
    );
    check(
      "the campaign spans several weeks, not one afternoon",
      (new Date(`${distinctDates[distinctDates.length - 1]}T00:00:00Z`) -
        new Date(`${distinctDates[0]}T00:00:00Z`)) /
        86_400_000 >=
        14,
      `${distinctDates[0]} to ${distinctDates[distinctDates.length - 1]}`,
    );
    check(
      "no segment was audited on a Sunday",
      distinctDates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0),
    );
    const weekday = distinctDates.filter((d) => {
      const day = new Date(`${d}T00:00:00Z`).getUTCDay();
      return day >= 1 && day <= 5;
    }).length;
    check(
      "field days are weighted toward weekdays",
      weekday / distinctDates.length >= 0.75,
      `${weekday}/${distinctDates.length}`,
    );
    check(
      "no single day carries more than a fifth of the survey",
      Math.max(
        ...distinctDates.map((d) => dates.filter((x) => x === d).length),
      ) <=
        audits.length / 5,
      `busiest day ${Math.max(...distinctDates.map((d) => dates.filter((x) => x === d).length))} segments`,
    );

    // A crew walks a neighbourhood, not one segment here and one across town.
    const collection = JSON.parse(
      readFileSync(path.join(ROOT, "data", "demo-segments.geojson"), "utf8"),
    );
    const midpoints = new Map(
      collection.features.map((f) => [
        f.properties.id,
        f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)],
      ]),
    );
    const crewDays = new Map();
    for (const [id, audit] of entries) {
      const key = `${audit.audited_on}|${audit.auditor}`;
      const bucket = crewDays.get(key) ?? [];
      bucket.push(midpoints.get(id));
      crewDays.set(key, bucket);
    }
    const spans = [...crewDays.values()].map((points) => {
      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      return (
        Math.max(
          Math.max(...lons) - Math.min(...lons),
          Math.max(...lats) - Math.min(...lats),
        ) * 111_000
      );
    });
    check(
      "a crew's day is geographically clustered (median span under 1 km)",
      median(spans) < 1000,
      `${Math.round(median(spans))} m`,
    );
    // Equal-sized days are the loudest tell in a generated calendar.
    const dayCounts = [...crewDays.values()].map((p) => p.length);
    check(
      "crew-days vary in size",
      new Set(dayCounts).size >= 4,
      `${new Set(dayCounts).size} distinct sizes, ${Math.min(...dayCounts)}-${Math.max(...dayCounts)} segments`,
    );
  }

  /* ---------------- Auditor labels: synthetic, never a person ---------------- */
  console.log("\nauditor labels");
  {
    const auditors = [...new Set(audits.map((a) => a.auditor))].sort();
    check(
      "more than one auditor label",
      auditors.length >= 2,
      auditors.join(", "),
    );
    check(
      "every label is a declared team, not a person",
      auditors.every((a) => /^Equipo StreetLens [A-Z]$/.test(a)),
      auditors.join(", "),
    );
    check(
      "the header block declares the same team set",
      Array.isArray(file.campaign?.teams) &&
        [...file.campaign.teams].sort().join("|") === auditors.join("|"),
    );
    // A "Firstname Lastname" label would read as a real surveyor's work.
    const personLike = auditors.filter((a) =>
      /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(a),
    );
    check(
      "no auditor label looks like a personal name",
      personLike.length === 0,
      personLike.join(", "),
    );
    check(
      "the placeholder 'demo-generator' auditor is gone",
      auditors.every((a) => a !== "demo-generator"),
    );
    check(
      "every audit names one of the declared teams",
      audits.every((a) => auditors.includes(a.auditor)),
    );
  }

  /* ---------------- Notes ---------------- */
  console.log("\nfield notes");
  {
    const withNote = observations.filter((o) => typeof o.note === "string" && o.note.length > 0);
    const coverage = withNote.length / observations.length;
    check(
      "25-40% of observations carry a field note",
      coverage >= 0.25 && coverage <= 0.4,
      `${(coverage * 100).toFixed(1)}% (${withNote.length}/${observations.length})`,
    );
    check(
      "every note is bilingual: Spanish in `note`, English in `note_en`",
      withNote.every((o) => typeof o.note_en === "string" && o.note_en.length > 0),
    );
    check(
      "an observation with no note has no stray English either",
      observations
        .filter((o) => !o.note)
        .every((o) => o.note_en === null || o.note_en === undefined),
    );
    check(
      "notes are varied, not a handful of sentences pasted 500 times",
      new Set(withNote.map((o) => o.note)).size >= 100,
      `${new Set(withNote.map((o) => o.note)).size} distinct notes`,
    );

    // A surveyor writes things down where something is wrong.
    const lowShare = share(
      observations.filter((o) => o.response <= 0.26),
      (o) => Boolean(o.note),
    );
    const highShare = share(
      observations.filter((o) => o.response > 0.62),
      (o) => Boolean(o.note),
    );
    check(
      "notes skew toward the low-scoring observations",
      lowShare > highShare * 2,
      `low ${(lowShare * 100).toFixed(0)}% vs high ${(highShare * 100).toFixed(0)}%`,
    );

    // A note about broken slabs under a segment with no sidewalk is the kind of
    // contradiction that gives generated data away.
    const contradictions = [];
    for (const [id, audit] of entries) {
      const byKey = Object.fromEntries(audit.observations.map((o) => [o.item_key, o]));
      if (byKey.sidewalk_present.response !== 0) continue;
      for (const key of ["sidewalk_width", "surface_condition", "curb_ramp"]) {
        if (byKey[key].note || byKey[key].photos.length > 0) contradictions.push(`${id}.${key}`);
      }
    }
    check(
      "no sidewalk means no notes or photos on the sidewalk-only items",
      contradictions.length === 0,
      contradictions.slice(0, 3).join(", "),
    );
  }

  /* ---------------- Photos ---------------- */
  console.log("\nphoto references");
  {
    const photos = observations.flatMap((o) => o.photos);
    check(
      "photo coverage is meaningfully above the old 31",
      photos.length >= 300,
      `${photos.length} references`,
    );
    check(
      "every photo keeps the demo/<segment>/<item>.jpg convention",
      photos.every((p) => /^demo\/esc-sa-\d+\/[a-z0-9_]+(-2)?\.jpg$/.test(p.storage_path)),
    );
    check(
      "every storage path is unique",
      new Set(photos.map((p) => p.storage_path)).size === photos.length,
    );
    check(
      "photos are timestamped inside their own audit's field day",
      entries.every(([, audit]) =>
        audit.observations.every((o) =>
          o.photos.every((p) => p.taken_at.startsWith(audit.audited_on)),
        ),
      ),
    );
    check(
      "photos land in field hours (13:00-21:30Z is 07:00-15:30 local)",
      photos.every((p) => {
        const hhmm = p.taken_at.slice(11, 16);
        return hhmm >= "13:00" && hhmm <= "21:30";
      }),
    );
    const photographed = new Set(
      entries
        .filter(([, a]) => a.observations.some((o) => o.photos.length > 0))
        .map(([id]) => id),
    );
    check(
      "photos are spread over many segments, not piled on a few",
      photographed.size >= 150,
      `${photographed.size} segments`,
    );
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(
    `\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`} — test-demo-audits.mjs`,
  );
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
