#!/usr/bin/env node
/**
 * test-map-cv-visibility.mjs (real-data era)
 *
 * Locks camera-observed map routing: a street the cameras have actually seen
 * must paint on the SAME per-lens score ramps as audited segments — not a
 * separate pink casing. Ground-truth field audits keep the ramp when both exist.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  COMMUNITY_CASING,
  COMMUNITY_LAYER_FILTER,
  RAMP,
  RAMP_LAYER_FILTER,
} = await import(path.join(ROOT, "components/mapConfig.ts"));

const { featureFilter } = await import(
  "@maplibre/maplibre-gl-style-spec"
);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function selects(filter, properties, zoom = 14) {
  return featureFilter(filter).filter({ zoom }, { type: 2, properties });
}

function casings(properties, zoom = 14) {
  return {
    ramp: selects(RAMP_LAYER_FILTER, properties, zoom),
    community: selects(COMMUNITY_LAYER_FILTER, properties, zoom),
  };
}

console.log("\nrouting — camera-observed segments use the score ramp");

{
  const c = casings({ source: "import", cv_count: 2, score_overall: 71 });
  check("import + camera observations → score ramp", c.ramp === true);
  check("import + camera observations → NOT neutral casing", c.community === false);
}

{
  const c = casings({ source: "import", cv_count: 0 });
  check("import, zero observations → neutral casing (unchanged)", c.community === true);
  check("import, zero observations → not the score ramp", c.ramp === false);
}
{
  const c = casings({ source: "import" });
  check("import, cv_count absent → neutral casing (unchanged)", c.community === true);
  check("import, cv_count absent → not the score ramp", c.ramp === false);
}
{
  const c = casings({ source: "community", cv_count: 1, score_overall: 55 });
  check("community + observations → score ramp, not neutral", c.ramp && !c.community);
}

{
  const c = casings({ source: "audit", cv_count: 3, score_overall: 80 });
  check("audited + observations → score ramp still draws it", c.ramp === true);
  check("audited + observations → never the neutral casing", c.community === false);
}
{
  const c = casings({ source: "audit" });
  check("audited, no observations → ramp only", c.ramp && !c.community);
}

console.log("\nno double-draw — ramp and neutral casings are disjoint");
for (const props of [
  { source: "import", cv_count: 1, score_overall: 60 },
  { source: "import", cv_count: 0 },
  { source: "community", cv_count: 5, score_overall: 42 },
  { source: "community" },
  { source: "audit", cv_count: 2, score_overall: 75 },
]) {
  const c = casings(props);
  check(
    `never both neutral and ramp: ${JSON.stringify(props)}`,
    !(c.community && c.ramp),
  );
}

console.log("\nsealed ramps — score colour encoding unchanged");
{
  const norm = (h) => h.toLowerCase();
  const rampStops = Object.values(RAMP)
    .flat()
    .map((s) => norm(s.hex));
  check("overall ramp still has three stops", RAMP.overall.length === 3);
  check(
    "neutral casing is not a score-ramp colour",
    !rampStops.includes(norm(COMMUNITY_CASING.color)) &&
      !rampStops.includes(norm(COMMUNITY_CASING.colorDark)),
    COMMUNITY_CASING.color,
  );
}

if (failures.length) {
  console.log(`\nFAIL — ${failures.length} case(s): ${failures.join("; ")}\n`);
  process.exit(1);
}
console.log("\nPASS — camera-observed segments route to score ramps (no pink identity layer)\n");
