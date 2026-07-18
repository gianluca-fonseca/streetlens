#!/usr/bin/env node
/**
 * test-map-cv-visibility.mjs (u31)
 *
 * Locks the camera-observed map treatment: a street the cameras have actually
 * seen must route to its OWN casing and must be excluded from the neutral
 * community casing, so it can never again render pixel-identical to the ~1,456
 * unaudited import segments (the #16 defect, where nothing in mapConfig keyed
 * off cv_observations at all).
 *
 * The filters are evaluated with MapLibre's real expression evaluator
 * (@maplibre/maplibre-gl-style-spec featureFilter) against synthetic features,
 * rather than regex-matching the source — a filter that parses is not a filter
 * that selects the right features.
 *
 * Also guards the two properties the mandate calls out as load-bearing:
 * the accent must be distinct from every score-ramp stop and from the neutral
 * casing, and the rendered width must hold a floor when zoomed out.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const {
  COMMUNITY_CASING,
  COMMUNITY_LAYER_FILTER,
  CV_CASING,
  CV_LAYER_FILTER,
  RAMP,
  RAMP_LAYER_FILTER,
  cvWidthExpression,
} = await import(path.join(ROOT, "components/mapConfig.ts"));

const { featureFilter, createExpression } = await import(
  "@maplibre/maplibre-gl-style-spec"
);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Evaluate a style filter against a synthetic line feature. */
function selects(filter, properties, zoom = 14) {
  return featureFilter(filter).filter({ zoom }, { type: 2, properties });
}

/** Which of the three casings claim this feature. */
function casings(properties, zoom = 14) {
  return {
    ramp: selects(RAMP_LAYER_FILTER, properties, zoom),
    community: selects(COMMUNITY_LAYER_FILTER, properties, zoom),
    cv: selects(CV_LAYER_FILTER, properties, zoom),
  };
}

console.log("\nrouting — which casing draws each feature");

// The headline case: demo data off, so every segment is source "import" and
// neutral. The one camera-observed street must break out of that pack.
{
  const c = casings({ source: "import", cv_count: 2 });
  check("import + camera observations → CV casing", c.cv === true);
  check("import + camera observations → NOT neutral casing", c.community === false);
  check("import + camera observations → not the score ramp", c.ramp === false);
}

// ...and its neighbours must be completely unchanged by this feature.
{
  const c = casings({ source: "import", cv_count: 0 });
  check("import, zero observations → neutral casing (unchanged)", c.community === true);
  check("import, zero observations → no CV casing", c.cv === false);
}
{
  // attachCommunity omits the key entirely on features with no observations;
  // the coalesce in CV_LAYER_FILTER is what makes the absent case safe.
  const c = casings({ source: "import" });
  check("import, cv_count absent → neutral casing (unchanged)", c.community === true);
  check("import, cv_count absent → no CV casing", c.cv === false);
}
{
  const c = casings({ source: "community", cv_count: 1 });
  check("community + observations → CV casing, not neutral", c.cv && !c.community);
}

// Audited segments keep their score ramp; the CV casing is an ADDITIONAL halo
// beneath it, so the sealed ramp encoding is never replaced or hidden.
{
  const c = casings({ source: "audit", cv_count: 3 });
  check("audited + observations → score ramp still draws it", c.ramp === true);
  check("audited + observations → CV casing also draws it (halo)", c.cv === true);
  check("audited + observations → never the neutral casing", c.community === false);
}
{
  const c = casings({ source: "audit" });
  check("audited, no observations → ramp only", c.ramp && !c.cv && !c.community);
}

console.log("\nno double-draw — the neutral and CV casings are disjoint");
for (const props of [
  { source: "import", cv_count: 1 },
  { source: "import", cv_count: 0 },
  { source: "community", cv_count: 5 },
  { source: "community" },
]) {
  const c = casings(props);
  check(
    `never both neutral and CV: ${JSON.stringify(props)}`,
    !(c.community && c.cv),
  );
}

console.log("\nvisual distinctness — the accent cannot collide");
{
  const norm = (h) => h.toLowerCase();
  const rampStops = Object.values(RAMP)
    .flat()
    .map((s) => norm(s.hex));
  for (const [name, hex] of [
    ["light", CV_CASING.color],
    ["dark", CV_CASING.colorDark],
  ]) {
    check(
      `CV ${name} accent is not a score-ramp colour`,
      !rampStops.includes(norm(hex)),
      hex,
    );
    check(
      `CV ${name} accent is not the neutral casing colour`,
      norm(hex) !== norm(COMMUNITY_CASING.color) &&
        norm(hex) !== norm(COMMUNITY_CASING.colorDark),
      hex,
    );
  }
  check(
    "CV casing is wider than the neutral casing",
    CV_CASING.width > COMMUNITY_CASING.width,
    `${CV_CASING.width} > ${COMMUNITY_CASING.width}`,
  );
  check(
    "CV casing is solid (no dash array), unlike the provisional neutral dash",
    !("dash" in CV_CASING),
  );
}

console.log("\nzoomed-out visibility — the width floor holds");
{
  // createExpression (not createPropertyExpression): line-width genuinely does
  // support feature-state, but the stricter property-expression validator
  // rejects it as a "data expression" under these parameters.
  const expr = createExpression(cvWidthExpression, {
    type: "number",
    property: true,
    expression: { interpolated: true, parameters: ["zoom", "feature-state"] },
  });
  if (expr.result === "error") {
    check(
      "cv width expression compiles",
      false,
      expr.value.map((e) => e.message || String(e)).join("; "),
    );
  } else {
    const widthAt = (zoom, state = {}) =>
      expr.value.evaluate({ zoom }, { type: 2, properties: {} }, state);
    const far = widthAt(9);
    const floor = widthAt(CV_CASING.minWidthZoom);
    const near = widthAt(CV_CASING.fullWidthZoom);
    check("width at far zoom holds the floor", far >= CV_CASING.minWidth, `${far}`);
    check("width at the floor zoom equals minWidth", floor === CV_CASING.minWidth, `${floor}`);
    check("width at full zoom equals the full width", near === CV_CASING.width, `${near}`);
    check("floor is thick enough to stay visible small", CV_CASING.minWidth >= 3, `${CV_CASING.minWidth}`);
    check(
      "selected is the thickest state",
      widthAt(14, { selected: true }) === CV_CASING.widthSelected,
    );
  }
}

if (failures.length) {
  console.log(`\nFAIL — ${failures.length} case(s): ${failures.join("; ")}\n`);
  process.exit(1);
}
console.log("\nPASS — camera-observed segments route to their own casing\n");
