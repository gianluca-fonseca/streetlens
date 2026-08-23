#!/usr/bin/env node
/**
 * test-school-score.mjs
 *
 * Locks the Escuela Segura standard: the arithmetic, the two rules that protect
 * the seal, and the walkshed data the arithmetic runs on.
 *
 * The properties worth guarding here are not "does it add up" — they are the
 * ones where a plausible-looking change would quietly turn the score into a
 * lie: unassessed streets leaking into the mean, the coverage gate letting a
 * three-segment sample publish, a mean averaging away a lethal gate, and an
 * unsurveyed school being ranked as though it had been surveyed.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-school-score");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const near = (a, b, eps = 0.15) => Math.abs(a - b) <= eps;

rmSync(BUILD_DIR, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc",
    "lib/school-score.ts",
    "lib/types.ts",
    "--outDir",
    BUILD_DIR,
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--target",
    "es2022",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { cwd: ROOT, stdio: "pipe" },
);

const {
  computeSchoolScore,
  computePriority,
  SCHOOL_ZONE,
  LENS_WEIGHTS,
  COVERAGE,
  GATE_VETO_MAX,
  LEY_7600_MIN_SCORE,
  CRASH_COMPONENT,
  TIER_CUTS,
} = require(path.join(BUILD_DIR, "school-score.js"));

/* ------------------------------------------------------------ fixtures */

const member = (id, ring, walk_m, length_m = 100) => ({
  segment_id: id,
  ring,
  walk_m,
  length_m,
});
const reading = (id, v, source = "camera") => [
  id,
  {
    segment_id: id,
    name: id,
    district: null,
    source,
    scores: { accessibility: v, drainage: v, shade: v, bike: v },
  },
];

console.log("the standard is internally consistent");
check(
  "lens weights sum to 1",
  near(Object.values(LENS_WEIGHTS).reduce((a, b) => a + b, 0), 1, 1e-9),
);
check("the gate ring is inside the walk ring", SCHOOL_ZONE.GATE_RADIUS_M < SCHOOL_ZONE.WALK_RADIUS_M);
check("the gate counts for more than the walk", SCHOOL_ZONE.RING_WEIGHT.gate > SCHOOL_ZONE.RING_WEIGHT.walk);
check("the seal demands more coverage than a score does", COVERAGE.MIN_FOR_SEAL > COVERAGE.MIN_FOR_SCORE);
check("the gate veto floor sits below the legal minimum", GATE_VETO_MAX < LEY_7600_MIN_SCORE);
check("tier cuts descend and bottom out at zero",
  TIER_CUTS.every((c, i) => i === 0 || c.min < TIER_CUTS[i - 1].min) &&
  TIER_CUTS.at(-1).min === 0);
// The crash term is the one Amadeo asked for and the one we do not have. It is
// carried at zero so its absence is stated rather than inferred.
check("crash density is declared, weighted zero, and explained",
  CRASH_COMPONENT.weight === 0 && CRASH_COMPONENT.note.length > 40);

console.log("");
console.log("an unassessed street is ignorance, not a zero");
{
  // The failure this guards: treating unscored segments as zeros would drag
  // every score down in proportion to how little has been surveyed, making a
  // well-surveyed school look worse than an unsurveyed neighbour.
  // Five members so that four readings still clear the coverage gate — the
  // point here is what an UNASSESSED segment does, which is only observable
  // above the gate.
  const members = Array.from({ length: 5 }, (_, i) => member(`m${i}`, "walk", 200 + i));
  const four = new Map(Array.from({ length: 4 }, (_, i) => reading(`m${i}`, 80)));
  const one = computeSchoolScore(members, four);
  const both = computeSchoolScore(
    members,
    new Map([...four, reading("m4", 80)]),
  );
  check("an unscored neighbour does not move the score", one.score === both.score, `${one.score} vs ${both.score}`);
  check("it moves coverage instead", one.coverage < both.coverage, `${one.coverage} vs ${both.coverage}`);
  check("and it is reported as a gap, not a finding", one.defects.length === both.defects.length);
  check("unassessed rows carry zero weight",
    one.contributions.find((c) => c.segment_id === "m4").weight === 0);
}

console.log("");
console.log("the coverage gate withholds a number it cannot stand behind");
{
  const members = [
    member("a", "walk", 200),
    member("b", "walk", 210),
    member("c", "walk", 220),
    member("d", "walk", 230),
    member("e", "walk", 240),
  ];
  const thin = computeSchoolScore(members, new Map([reading("a", 95)]));
  check("a 20%-covered zone publishes no tier", thin.tier === "sin_datos");
  check("and no score", thin.score === null);
  check("and no compliance figure", thin.compliance === null);
  // The admin still needs to see what the thin sample says, or there is nothing
  // to judge the gate against.
  check("but the contribution table is still built", thin.contributions.length === 5);

  const covered = computeSchoolScore(
    members,
    new Map([reading("a", 95), reading("b", 95), reading("c", 95), reading("d", 95)]),
  );
  check("an 80%-covered zone does publish", covered.tier !== "sin_datos" && covered.score !== null);
}

console.log("");
console.log("one lethal gate segment caps the school");
{
  const members = [
    member("gate-bad", "gate", 40),
    ...Array.from({ length: 9 }, (_, i) => member(`w${i}`, "walk", 200 + i)),
  ];
  const readings = new Map([
    reading("gate-bad", 10),
    ...Array.from({ length: 9 }, (_, i) => reading(`w${i}`, 95)),
  ]);
  const s = computeSchoolScore(members, readings, { hasFieldAudit: true });
  check("the average is comfortably high", s.score > 60, String(s.score));
  check("but the tier is capped at critico", s.tier === "critico");
  check("the veto is attributed to the segment", s.gate_veto && s.gate_veto_segments.includes("gate-bad"));
  check("and the seal is blocked for it", s.seal.blockers.includes("gate_veto"));
}

console.log("");
console.log("the seal needs a human, not just a good average");
{
  const members = Array.from({ length: 10 }, (_, i) => member(`s${i}`, "walk", 200 + i));
  const readings = new Map(Array.from({ length: 10 }, (_, i) => reading(`s${i}`, 95, "camera")));
  const cameraOnly = computeSchoolScore(members, readings, { hasFieldAudit: false });
  check("a camera-only zone reaches the top tier", cameraOnly.tier === "escuela_segura");
  check("but is not seal-eligible", !cameraOnly.seal.eligible && cameraOnly.seal.blockers.includes("field_audit"));

  const audited = computeSchoolScore(
    members,
    new Map(Array.from({ length: 10 }, (_, i) => reading(`s${i}`, 95, "audit"))),
    { hasFieldAudit: true },
  );
  check("with a field audit it becomes eligible", audited.seal.eligible, audited.seal.blockers.join(","));
}

console.log("");
console.log("the contribution table explains the score it belongs to");
{
  const members = [member("gate", "gate", 50, 100), member("far", "walk", 300, 100)];
  const s = computeSchoolScore(members, new Map([reading("gate", 40), reading("far", 80)]));
  const sum = s.contributions.reduce((m, c) => m + c.points, 0);
  check("points sum to the score", near(sum, s.score), `${sum.toFixed(2)} vs ${s.score}`);
  check("shares sum to 1", near(s.contributions.reduce((m, c) => m + c.weight_share, 0), 1, 1e-6));
  const gate = s.contributions.find((c) => c.segment_id === "gate");
  const far = s.contributions.find((c) => c.segment_id === "far");
  // Equal lengths, so the gate's larger share IS the ring weight, visibly.
  check("equal-length gate frontage outweighs the walk ring",
    near(gate.weight_share / far.weight_share, SCHOOL_ZONE.RING_WEIGHT.gate, 1e-6));
  check("per-lens points sum to the row's points",
    s.contributions.every((c) =>
      near(Object.values(c.lens_points).reduce((m, v) => m + v, 0), c.points, 0.01)));
  check("the Ley 7600 verdict follows the threshold",
    gate.ley7600 === "fail" && far.ley7600 === "pass");
}

console.log("");
console.log("compliance is length-weighted, not a segment count");
{
  // One long compliant street and three short failing ones: counting segments
  // says 25% compliant, but a child walks metres, not segments.
  const members = [
    member("long", "walk", 200, 900),
    member("s1", "walk", 210, 30),
    member("s2", "walk", 220, 30),
    member("s3", "walk", 230, 30),
  ];
  const s = computeSchoolScore(
    members,
    new Map([reading("long", 90), reading("s1", 10), reading("s2", 10), reading("s3", 10)]),
  );
  check("compliance reflects metres walked", s.compliance > 0.85, `${(100 * s.compliance).toFixed(1)}%`);
}

console.log("");
console.log("priority does not punish a school for not being surveyed");
{
  const unscored = computePriority({
    score: null, coverage: 0, gate_veto: false, sector: "public", level: "primary",
    gate_points_recoverable: 0, total_points_recoverable: 0,
  });
  check("an unscored school has no rank", unscored.rank_score === null && unscored.reason === "unscored");

  const base = {
    score: 40, coverage: 1, gate_veto: false, level: "primary",
    gate_points_recoverable: 5, total_points_recoverable: 10,
  };
  const pub = computePriority({ ...base, sector: "public" });
  const priv = computePriority({ ...base, sector: "private" });
  check("a public school outranks an identical private one", pub.rank_score > priv.rank_score);

  const cheap = computePriority({ ...base, sector: "public", gate_points_recoverable: 10, total_points_recoverable: 10 });
  const dear = computePriority({ ...base, sector: "public", gate_points_recoverable: 0, total_points_recoverable: 10 });
  check("a gate-fixable school outranks a corridor rebuild", cheap.rank_score > dear.rank_score);
  check("and the reason says which it is", cheap.reason === "gate_fixable" && dear.reason === "corridor");
}

console.log("");
console.log("the precomputed walkshed matches the standard");
{
  const zones = JSON.parse(read("data/school-zones.json"));
  const schools = JSON.parse(read("data/schools.geojson"));
  const segments = JSON.parse(read("data/segments.geojson"));
  const segIds = new Set(segments.features.map((f) => f.properties.id));
  const build = read("scripts/build-school-zones.mjs");

  // The build script cannot import the .ts constants, so the radii are
  // replicated there. This is the guard that keeps the copies honest.
  check("the build script's radii match lib/school-score.ts",
    zones.gate_radius_m === SCHOOL_ZONE.GATE_RADIUS_M &&
    zones.walk_radius_m === SCHOOL_ZONE.WALK_RADIUS_M,
    `${zones.gate_radius_m}/${zones.walk_radius_m}`);
  check("every school has a zone",
    zones.zones.length === schools.features.length,
    `${zones.zones.length}/${schools.features.length}`);
  check("every zone member is a real segment",
    zones.zones.every((z) => z.members.every((m) => segIds.has(m.segment_id))));
  check("no member sits beyond the walk radius",
    zones.zones.every((z) => z.members.every((m) => m.walk_m <= zones.walk_radius_m + 0.01)));
  check("ring assignment follows the gate radius",
    zones.zones.every((z) =>
      z.members.every((m) => (m.walk_m <= zones.gate_radius_m) === (m.ring === "gate"))));
  check("members are unique within a zone",
    zones.zones.every((z) => new Set(z.members.map((m) => m.segment_id)).size === z.members.length));
  check("counts and lengths agree with the member list",
    zones.zones.every((z) =>
      z.counts.members === z.members.length &&
      z.counts.gate === z.members.filter((m) => m.ring === "gate").length));
  // A walkshed that reached as far as a straight line would mean the router
  // silently fell back to crow-flies, which is the whole thing it exists to avoid.
  const meanMembers = zones.totals.mean_members;
  check("the walkshed is materially tighter than a plain circle",
    meanMembers > 5 && meanMembers < 35, `mean ${meanMembers} members`);
  check("the zone file states it holds no scores",
    /no scores/i.test(zones.note) && zones.generated_by === "scripts/build-school-zones.mjs");
  check("motorway-class ways are excluded from the walk",
    build.includes("NON_WALKABLE") && zones.non_walkable.includes("motorway"));
}

console.log("");
console.log("the seal");
{
  const comp = read("components/schools/EscuelaSeguraSeal.tsx");
  const script = read("scripts/render-seal.mjs");
  const svg = read("docs/assets/escuela-segura-seal-light.svg");

  // The component ships on the site and the script feeds slides. Two drawings
  // of one mark drift; these checks are what keep them the same mark.
  const bars = (src) => [...src.matchAll(/y:\s*(\d+),\s*half:\s*([\d.]+),\s*w:\s*([\d.]+)/g)]
    .map((m) => m.slice(1).join("/"));
  check("the component and the export draw the same crossing",
    bars(comp).length === 4 && bars(comp).join("|") === bars(script).join("|"),
    bars(comp).join(" "));
  check("both place the validity band identically",
    /y1="130"[\s\S]{0,260}y="142"/.test(comp) && /y1="130"[\s\S]{0,260}y="142"/.test(script));

  // A seal is a PASS mark. Minting failing variants would turn certification
  // into a shaming badge, which is both cruel and self-defeating.
  check("only two states exist, and neither names a failing tier",
    /SealState = "awarded" \| "pending"/.test(comp) &&
    !/critico|en_riesgo/.test(comp.replace(/sealStateFor[\s\S]{0,160}/, "")));
  check("the seal expires", /VIGENTE/.test(comp) && /validUntil/.test(comp));
  check("the awarding body is a labelled slot, not a drawn logo",
    /awardedBy/.test(comp) && /logo del ente/i.test(comp) && !/purdy/i.test(comp));
  check("the exported SVG is well-formed and self-coloured",
    svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>") && !svg.includes("currentColor"));
}

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS — school score standard");
