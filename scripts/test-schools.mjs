#!/usr/bin/env node
/**
 * test-schools.mjs
 *
 * Locks the school roster and its map overlay.
 *
 * The data half is the part that matters most: this file is what a partner
 * proposal is built on, so the checks are about PROVENANCE, not shape. Every
 * pin has to say where its coordinate came from, every registry row has to be
 * reachable from a pin, and the two judgement calls the build script makes
 * (a mis-filed canton, a school that moved out in 2016) have to stay argued in
 * the metadata rather than quietly applied.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

console.log("roster (data/schools.geojson)");
const schools = JSON.parse(read("data/schools.geojson"));
const feats = schools.features;
const meta = schools.metadata;

check("is a FeatureCollection with pins", schools.type === "FeatureCollection" && feats.length > 0,
  `${feats.length} sites`);
check("counts in metadata match the features",
  meta.counts.sites === feats.length &&
  meta.counts.public === feats.filter((f) => f.properties.sector === "public").length &&
  meta.counts.private === feats.filter((f) => f.properties.sector === "private").length,
  `${meta.counts.public} public / ${meta.counts.private} private`);

check("every pin carries both sectors' worth of coverage",
  meta.counts.public > 0 && meta.counts.private > 0);

// Escazú canton bbox, from OSM relation 4071270. A pin outside it is either a
// bad registry coordinate or a matcher that reached across the canton line, and
// both are the kind of error that would be quoted at a partner as fact.
const BBOX = { minLat: 9.8595, minLon: -84.1859, maxLat: 9.9727, maxLon: -84.1206 };
const stray = feats.filter(({ geometry: g }) => {
  const [lon, lat] = g.coordinates;
  return lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon;
});
check("every pin falls inside the canton bbox", stray.length === 0,
  stray.map((f) => f.properties.name).join(", "));

check("every pin has a point geometry with finite coordinates",
  feats.every(
    (f) =>
      f.geometry.type === "Point" &&
      f.geometry.coordinates.length === 2 &&
      f.geometry.coordinates.every(Number.isFinite),
  ));

check("ids are unique and mirrored onto properties",
  new Set(feats.map((f) => f.id)).size === feats.length &&
  feats.every((f) => f.id === f.properties.id));

check("sector is always one of the two registers",
  feats.every((f) => f.properties.sector === "public" || f.properties.sector === "private"));

check("every pin declares where its coordinate came from",
  feats.every((f) => f.properties.position_source === "osm" || f.properties.position_source === "mep"));

check("an OSM-positioned pin reports how far it moved from the registry point",
  feats
    .filter((f) => f.properties.position_source === "osm" && f.properties.registry === "mep")
    .every((f) => Number.isFinite(f.properties.position_delta_m)));

// The matcher's whole risk is reaching too far and fusing two schools. The
// closest two distinct sites in the canton sit ~96 m apart, so a delta near the
// 400 m ceiling means a pin was dragged onto a neighbour's campus.
const farMatches = feats.filter((f) => (f.properties.position_delta_m ?? 0) > 150);
check("no pin was dragged more than 150 m onto an OSM campus", farMatches.length === 0,
  farMatches.map((f) => `${f.properties.name} ${f.properties.position_delta_m}m`).join(", "));

check("registry rows are all reachable from some pin",
  feats.reduce((n, f) => n + f.properties.programmes.length, 0) === meta.counts.registry_rows,
  `${meta.counts.registry_rows} rows across ${feats.length} pins`);

check("a pin's own MEP code is one of its programmes",
  feats
    .filter((f) => f.properties.registry === "mep")
    .every((f) => f.properties.programmes.some((p) => p.code === f.properties.mep_code)));

check("an OSM-only pin explains itself",
  feats
    .filter((f) => f.properties.registry === "osm")
    .every((f) => typeof f.properties.registry_note === "string" && f.properties.registry_note.length > 20));

check("display names are cased, not the register's caps",
  feats.every((f) => f.properties.display_name && f.properties.display_name !== f.properties.name.toUpperCase()
    || !/[A-Z]{4,}/.test(f.properties.name)));

check("every pin has a human-readable address, not just a coordinate",
  feats.every((f) => typeof f.properties.address === "string" && f.properties.address.length > 3),
  `${feats.filter((f) => f.properties.address).length}/${feats.length}`);

check("level is never invented — it is a known value or null",
  feats.every((f) =>
    f.properties.level === null ||
    ["preschool", "primary", "preschool_primary", "secondary", "basica_general", "adult"].includes(
      f.properties.level,
    )));

console.log("");
console.log("provenance (the argument a partner can check)");
check("both upstream sources are named", meta.sources.length >= 2 &&
  meta.sources.some((s) => s.id === "mep-sigmep") &&
  meta.sources.some((s) => s.id === "osm"));
check("OSM's licence is stated", meta.sources.some((s) => s.licence === "ODbL"));
check("every excluded registry row carries its reason",
  meta.excluded.length > 0 && meta.excluded.every((e) => e.why && e.why.length > 40));
check("every rejected OSM feature carries its reason",
  meta.osm_rejected.length > 0 && meta.osm_rejected.every((e) => e.why && e.why.length > 40));

const build = read("scripts/build-schools.mjs");
check("the roster is regenerable, not hand-maintained",
  meta.generated_by === "scripts/build-schools.mjs" &&
  build.includes("MEP_CEPUBCR_1") && build.includes("MEP_CEPRIVCR_1"));
check("the two judgement calls live in the script, not in the data",
  build.includes("EXCLUDE") && build.includes("OSM_ONLY_ADMIT") && build.includes("OSM_ONLY_REJECT"));

console.log("");
console.log("overlay wiring");
const audit = read("components/AuditMap.tsx");
const config = read("components/mapConfig.ts");
const toggle = read("components/SchoolsToggle.tsx");
const card = read("components/SchoolDetail.tsx");

check("pins separate by FORM, so they survive greyscale and CVD",
  /schoolFillExpression/.test(config) &&
  /"=="\s*,\s*\["get",\s*"sector"\],\s*"public"/.test(config));
check("pins spend no chroma — they take the page's own ink",
  /fill: "#3d3d3d"/.test(config) && /fill: "#d8d8d8"/.test(config));
check("the overlay is created once and toggled by visibility",
  audit.includes("applySchoolsVisible") &&
  audit.includes('setLayoutProperty(id, "visibility"'));
// Compared at the CALL SITES inside onLoad, not at the definitions: MapLibre
// stacks layers in the order they are added, so what puts a pin over a relief
// volume is which invocation runs second.
const onLoadBody = audit.slice(audit.indexOf("const onLoad = ()"));
check("pins are added AFTER the relief so they stay on top",
  onLoadBody.indexOf("addSchoolLayers(\n") > onLoadBody.indexOf("addReliefLayer(\n") &&
  onLoadBody.indexOf("addReliefLayer(\n") > -1);
check("a pin click wins over the segment under it",
  audit.includes("queryRenderedFeatures(e.point, { layers: [SCHOOLS_LAYER_ID] })"));
// MapLibre's default font stack is not served by the Liberty glyph endpoint, so
// an unpinned text-font means labels that never draw and a console full of 404s.
check("the label font is pinned to a stack the basemap serves",
  /"text-font": \["Noto Sans (Regular|Bold|Italic)"\]/.test(audit));
check("maplibre's JSON-stringified properties are parsed back",
  audit.includes("parseSchoolProps") && audit.includes("JSON.parse(programmes)"));
check("the overlay choice is remembered",
  audit.includes("readSchoolsOverlay") && audit.includes("writeSchoolsOverlay") &&
  read("lib/schools-overlay.ts").includes("localStorage"));
check("schools are a switch, not a sixth lens in the radiogroup",
  !read("components/LayerSwitcher.tsx").includes("school") &&
  toggle.includes('type="checkbox"'));
check("the key names both pin forms in text, never colour alone",
  /\[\s*"public",[\s\S]*?\[\s*"private",/.test(toggle) &&
  toggle.includes("t(`sector.${sector}`)"));
check("the card is a dialog and closes on Escape",
  card.includes('role="dialog"') && card.includes('aria-modal="true"') &&
  card.includes('e.key === "Escape"'));
check("the card states its provenance rather than hiding it",
  card.includes("provenanceMepOsm") && card.includes("provenanceMepOnly") &&
  card.includes("provenanceOsmOnly"));

console.log("");
console.log("i18n parity for the schools namespace");
for (const locale of ["en", "es"]) {
  const m = JSON.parse(read(`messages/${locale}.json`));
  check(`${locale}: schools namespace exists`, Boolean(m.schools));
  check(`${locale}: both sectors are labelled`,
    Boolean(m.schools?.sector?.public && m.schools?.sector?.private));
  check(`${locale}: every level the data uses has a label`,
    feats.every((f) => f.properties.level === null || Boolean(m.schools?.level?.[f.properties.level])));
  check(`${locale}: the OSM-distance string interpolates the delta`,
    (m.schools?.provenanceMepOsm ?? "").includes("{delta}"));
}

console.log("");
console.log("field route (data/route/)");
const route = JSON.parse(read("data/route/school-route.geojson"));
const gpx = read("data/route/school-route.gpx");
const sheet = read("data/route/SCHOOL-ROUTE.md");
const routeStops = route.features.filter((f) => f.geometry.type === "Point");

// The one failure mode that actually costs a field day: a school quietly
// missing from the sheet the driver is holding.
check("every school is on the route exactly once",
  routeStops.length === feats.length &&
  new Set(routeStops.map((f) => f.properties.school_id)).size === feats.length,
  `${routeStops.length} stops for ${feats.length} schools`);
check("every school has a GPX waypoint",
  (gpx.match(/<wpt /g) ?? []).length === feats.length);
check("the GPX is well-formed enough to carry a route per leg",
  gpx.startsWith("<?xml") && gpx.includes("</gpx>") &&
  (gpx.match(/<rte>/g) ?? []).length === route.metadata.legs.length);
check("stop numbers within a leg are 1..n with no gaps",
  route.metadata.legs.every((_, li) => {
    const inLeg = routeStops.filter((f) => f.properties.leg === li + 1)
      .map((f) => f.properties.stop).sort((a, b) => a - b);
    return inLeg.every((n, i) => n === i + 1);
  }));
// A one-stop "leg" is what a pure longest-hop cut produces, and it is a plan
// nobody drives. Balance is the property, not the specific split.
check("no leg is trivially small",
  route.metadata.legs.every((l) => l.stops >= 3),
  route.metadata.legs.map((l) => l.stops).join("/"));
check("every stop is navigable from a phone",
  routeStops.every((f) => /^https:\/\/waze\.com\/ul\?ll=-?\d+\.\d+,-?\d+\.\d+&navigate=yes$/.test(f.properties.waze)) &&
  routeStops.every((f) => typeof f.properties.address === "string"));
check("the sheet carries an address column and per-stop Waze links",
  /\| Address \|/.test(sheet) &&
  (sheet.match(/\[Waze\]\(https:\/\/waze\.com\/ul/g) ?? []).length === feats.length);
check("the sheet says Waze is one stop at a time",
  /Waze takes one stop at a time/i.test(sheet));
check("the sheet says the order is not a driving route",
  /visiting order, not a driving route/i.test(sheet));
check("every leg gets Google Maps links on the sheet",
  (sheet.match(/google\.com\/maps\/dir\//g) ?? []).length >= route.metadata.legs.length);
const page = read("data/route/school-route.html");
check("the run-sheet page carries every stop with a Waze control",
  (page.match(/class="stop"/g) ?? []).length === feats.length &&
  (page.match(/waze\.com\/ul/g) ?? []).length === feats.length);
check("the page names itself and paints its own ground",
  /^<title>[^<]{4,60}<\/title>/m.test(page) && /body\s*\{[^}]*background:\s*var\(--paper\)/s.test(page));
// The classic unreadable-artifact bug: a colour whose only definition sits
// behind a theme stamp never applies in the un-stamped "system" state.
check("both themes are defined at token level, including the un-stamped state",
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/.test(page) &&
  /:root\[data-theme="dark"\]/.test(page) &&
  /:root\s*\{[^}]*--paper:/s.test(page));
check("the page reuses the map's public/private mark, not a new one",
  /\.disc\.public\s*\{\s*background:\s*var\(--ink\)/.test(page) &&
  /\.disc\.private\s*\{\s*background:\s*var\(--plate\)/.test(page));
check("navigation controls clear the 44px tap floor",
  /\.go a \{[^}]*min-height:\s*44px/s.test(page));

check("the route is regenerable from the roster",
  route.metadata.generated_by === "scripts/build-school-route.mjs" &&
  read("scripts/build-school-route.mjs").includes("data\", \"schools.geojson"));

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS — schools roster and overlay");
