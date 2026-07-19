#!/usr/bin/env node
/**
 * test-civic-pack.mjs — Ley brief aggregations + open-data scrub/bound contract.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-civic-pack");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/ley-brief.ts",
      "lib/open-data.ts",
      "lib/municipality.ts",
      "lib/cv-provenance.ts",
      "lib/types.ts",
      "--outDir",
      BUILD_DIR,
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
}

function feature(id, district, accessibility, extras = {}) {
  return {
    type: "Feature",
    properties: {
      id,
      name: `Street ${id}`,
      district,
      score_overall: accessibility,
      score_accessibility: accessibility,
      score_drainage: 50,
      score_shade: 50,
      score_bike: 50,
      audited_at: extras.audited_at ?? "",
      demo: false,
      source: extras.source,
      cv_count: extras.cv_count ?? 0,
      cv_accessibility: extras.cv_accessibility,
      ...extras,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-84.1, 9.9],
        [-84.0, 9.9],
      ],
    },
  };
}

function main() {
  compile();
  const Brief = require(path.join(BUILD_DIR, "ley-brief.js"));
  const Open = require(path.join(BUILD_DIR, "open-data.js"));
  const Muni = require(path.join(BUILD_DIR, "municipality.js"));

  console.log("\nmunicipality config");
  {
    check("name is a string", typeof Muni.MUNICIPALITY.name === "string");
    check("rubric version set", Muni.MUNICIPALITY.rubricVersion === "v0.1");
    check(
      "brand marks are public paths",
      Muni.MUNICIPALITY.brandMarkLight.startsWith("/brand/"),
    );
  }

  console.log("\nley brief — district + worst corridors");
  {
    const collection = {
      type: "FeatureCollection",
      features: [
        feature("a", "District A", 20, { cv_count: 1 }),
        feature("b", "District A", 80, { cv_count: 1 }),
        feature("c", "District B", 10, { cv_count: 1 }),
        feature("d", "District B", 0, { source: "import" }), // no evidence
        feature("e", "District A", 40, {
          audited_at: "2026-01-01",
          source: "audit",
        }),
      ],
    };
    const summary = Brief.buildLeyBriefSummary(collection, 3);
    check("threshold is 50", summary.threshold === 50);
    check("observed excludes import-only zeros", summary.observed === 4);
    check("failing count", summary.failing === 3);
    check("fail rate rounded", summary.failRatePct === 75);
    check("two districts", summary.districts.length === 2);
    check(
      "worst corridor is lowest accessibility",
      summary.worstCorridors[0]?.id === "c" &&
        summary.worstCorridors[0]?.accessibility === 10,
    );
    check("worst list bounded", summary.worstCorridors.length === 3);
  }

  console.log("\nopen data — scrub + bound + csv");
  {
    const obs = {
      id: "cv-1",
      segment_id: "a",
      session_id: "secret-session",
      scores: {
        overall: 20,
        accessibility: 20,
        drainage: 20,
        shade: 20,
        bike: 20,
      },
      item_medians: {},
      confidence: 0.5,
      coverage: 0.5,
      frame_refs: ["captures/x/frame.jpg"],
      captured_on: "2026-07-01T12:00:00.000Z",
      source: "cv",
      submission_id: null,
      created_at: "2026-07-02T12:00:00.000Z",
    };
    const collection = {
      type: "FeatureCollection",
      features: [
        feature("a", "District A", 20, {
          cv_count: 1,
          cv_overall: 20,
          cv_accessibility: 20,
          source: "import",
        }),
        feature("skip", "District A", 0, { source: "import" }),
      ],
    };
    const lengths = new Map([["a", 100.5]]);
    const cvBy = new Map([["a", [obs]]]);
    const geo = Open.buildOpenDataGeoJson(collection, lengths, cvBy);
    check("only evidenced features", geo.features.length === 1);
    check("bounded metadata flag", geo.metadata.bounded === true);
    check("municipality from config", geo.metadata.municipality === Muni.MUNICIPALITY.name);
    const props = geo.features[0].properties;
    check("scrubbed props", Open.assertOpenDataScrubbed(props));
    check("no session_id", !("session_id" in props));
    check("no frame_refs", !("frame_refs" in props));
    check("captured_on from canonical", props.captured_on === obs.captured_on);
    check("length_m enriched", props.length_m === 100.5);
    check("rubric version stamped", props.rubric_version === "v0.1");

    const csv = Open.buildOpenDataCsv(collection, lengths, cvBy);
    check("csv has header", csv.startsWith("id,name,district"));
    check("csv has one data row", csv.trim().split("\n").length === 2);
    check("csv omits session secret", !csv.includes("secret-session"));
    check("csv omits frame path", !csv.includes("frame.jpg"));
  }

  console.log("\nroutes + pages exist");
  {
    const files = [
      "app/api/open-data/geojson/route.ts",
      "app/api/open-data/gejson/route.ts",
      "app/api/open-data/csv/route.ts",
      "app/[locale]/brief/page.tsx",
      "app/[locale]/data/page.tsx",
      "app/[locale]/press/page.tsx",
      "public/brand/streetlens-mark-light.svg",
      "public/brand/streetlens-mark-dark.svg",
    ];
    for (const f of files) {
      check(`exists ${f}`, existsSync(path.join(ROOT, f)));
    }
  }

  console.log("\ni18n namespaces present");
  {
    for (const locale of ["en", "es"]) {
      const msg = JSON.parse(
        readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"),
      );
      check(`${locale} brief.title`, typeof msg.brief?.title === "string");
      check(`${locale} data.title`, typeof msg.data?.title === "string");
      check(`${locale} press.title`, typeof msg.press?.title === "string");
      check(
        `${locale} data.fields.id`,
        typeof msg.data?.fields?.id === "string",
      );
    }
  }

  console.log("");
  if (failures.length) {
    console.error(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("PASS — civic pack brief + open-data + press surfaces locked.");
}

main();
