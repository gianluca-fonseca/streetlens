#!/usr/bin/env node
/**
 * test-insights.mjs — locks insights aggregations and route contracts.
 *
 * Compiles lib/insights.ts (+ municipality, rubric-public, segment-links) and
 * drives district rollups, worst-street ranking, lens bins, timeline, and
 * coverage progress. Also static-checks the public routes and i18n namespaces.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-insights");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function feature(id, district, cvOverall, length = 100) {
  return {
    type: "Feature",
    properties: {
      id,
      name: `Street ${id}`,
      district,
      score_overall: 0,
      score_accessibility: 0,
      score_drainage: 0,
      score_shade: 0,
      score_bike: 0,
      audited_at: "",
      demo: false,
      source: "import",
      cv_count: cvOverall === null ? 0 : 1,
      cv_overall: cvOverall,
      cv_accessibility: cvOverall === null ? null : Math.max(0, cvOverall - 5),
      cv_drainage: cvOverall,
      cv_shade: cvOverall,
      cv_bike: cvOverall,
      _length: length,
    },
    geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] },
  };
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/insights.ts",
      "lib/municipality.ts",
      "lib/rubric-public.ts",
      "lib/segment-links.ts",
      "lib/types.ts",
      "--outDir",
      BUILD_DIR,
      "--rootDir",
      "lib",
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--target",
      "es2019",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const I = require(path.join(BUILD_DIR, "insights.js"));
  const M = require(path.join(BUILD_DIR, "municipality.js"));
  const R = require(path.join(BUILD_DIR, "rubric-public.js"));
  const L = require(path.join(BUILD_DIR, "segment-links.js"));

  console.log("\nmunicipality + rubric + links");
  const muni = M.getMunicipality();
  check("municipality has name", typeof muni.name === "string" && muni.name.length > 0);
  check("15 rubric items", R.PUBLIC_RUBRIC_ITEMS.length === 15);
  check("streetPagesAvailable is boolean", typeof L.streetPagesAvailable() === "boolean");
  check(
    "insightSegmentHref falls back to map when no street page",
    !L.streetPagesAvailable()
      ? L.insightSegmentHref("esc-sa-1").startsWith("/map?")
      : L.insightSegmentHref("esc-sa-1").startsWith("/street/"),
  );

  console.log("\naggregations");
  const segments = {
    type: "FeatureCollection",
    features: [
      feature("a", "Alpha", 22, 200),
      feature("b", "Alpha", 80, 100),
      feature("c", "Beta", 35, 50),
      feature("d", "Gamma", null, 300),
      feature("e", "Beta", 10, 150),
    ],
  };
  // Dedupe by street name: Street a / b / c / e are distinct names
  const lengthById = new Map(
    segments.features.map((f) => [f.properties.id, f.properties._length]),
  );

  const districts = I.computeDistrictRollups(segments, lengthById);
  check("districts derived dynamically (3)", districts.length === 3, `${districts.length}`);
  check(
    "no hardcoded district triad required",
    districts.every((d) => ["Alpha", "Beta", "Gamma"].includes(d.name)),
  );
  const alpha = districts.find((d) => d.name === "Alpha");
  check("Alpha has camera km", alpha && alpha.cvKm > 0);

  const worst = I.listWorstCvStreets(segments, { limit: 5 });
  check("worst ranks lowest first", worst[0].score === 10, JSON.stringify(worst.map((w) => w.score)));
  check("unobserved streets excluded", worst.every((w) => w.score !== null));

  const dist = I.computeLensDistribution(segments, "overall");
  check("lens distribution counts observed", dist.observed === 4);
  check("poor bin has entries", dist.bins.find((b) => b.key === "poor").count >= 2);

  const walks = [
    {
      segment_id: "a",
      captured_on: "2026-07-01T12:00:00.000Z",
      scores: { overall: 22, accessibility: 20, drainage: 22, shade: 22, bike: 22 },
    },
    {
      segment_id: "e",
      captured_on: "2026-07-02T12:00:00.000Z",
      scores: { overall: 10, accessibility: 8, drainage: 10, shade: 10, bike: 10 },
    },
    {
      segment_id: "c",
      captured_on: "2026-07-02T15:00:00.000Z",
      scores: { overall: 35, accessibility: 30, drainage: 35, shade: 35, bike: 35 },
    },
  ];
  const index = I.indexSegmentsById(segments);
  const timeline = I.buildObservationTimeline(walks, index);
  check("timeline newest day first", timeline[0].day === "2026-07-02");
  check("july 2 groups two segments", timeline[0].segmentCount === 2);

  const coverage = I.computeCoverageProgress(walks, lengthById, 800);
  check("coverage has points", coverage.points.length === 2);
  check(
    "coverage cumulative grows",
    coverage.points[1].cumulativeKm >= coverage.points[0].cumulativeKm,
  );

  console.log("\nroutes + i18n");
  for (const route of ["insights", "method", "rubric"]) {
    check(
      `route app/[locale]/${route}/page.tsx`,
      existsSync(path.join(ROOT, "app/[locale]", route, "page.tsx")),
    );
  }
  const en = JSON.parse(readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
  const es = JSON.parse(readFileSync(path.join(ROOT, "messages/es.json"), "utf8"));
  for (const ns of ["insights", "methodPage", "rubricPage"]) {
    check(`EN has ${ns}`, !!en[ns]);
    check(`ES has ${ns}`, !!es[ns]);
  }
  check("EN rubric has 15 items", Object.keys(en.rubricPage.items).length === 15);
  check("ES rubric has 15 items", Object.keys(es.rubricPage.items).length === 15);
  check("mapChrome insights link EN", !!en.mapChrome.insights);
  check("mapChrome insights link ES", !!es.mapChrome.insights);

  const pkg = readFileSync(path.join(ROOT, "package.json"), "utf8");
  check("no recharts dep", !pkg.includes("recharts"));
  check("no chart.js dep", !pkg.includes("chart.js"));
  check("no d3 dep", !/"d3"/.test(pkg));

  const hero = readFileSync(path.join(ROOT, "components/landing/Hero.tsx"), "utf8");
  check("Hero uses listWorstCvStreets", hero.includes("listWorstCvStreets"));
  check("Hero banner links insights", hero.includes('href="/insights"'));

  const chrome = readFileSync(path.join(ROOT, "components/MapChrome.tsx"), "utf8");
  check("MapChrome links insights", chrome.includes('href="/insights"'));

  console.log("");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("PASS");
}

main();
