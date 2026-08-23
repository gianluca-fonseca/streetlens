// scripts/build-school-route.mjs
//
// Turns data/schools.geojson into a FIELD PLAN: the order to drive the canton's
// schools in, and the waypoint files a phone or a GPS unit can actually follow.
//
// Emits, into data/route/:
//   school-route.gpx           every school as a <wpt>, plus one <rte> per leg
//   school-route.geojson       ordered points + the connecting line, for the map
//   SCHOOL-ROUTE.md            the printable run sheet: order, coordinates, and
//                              Google Maps links batched so each one opens
//
// ── WHY THE LEGS ARE CUT BY POSITION, NOT BY DISTRICT ──────────────────────
// The canton's schools are not one drive. San Rafael sits up in Guachipelín
// around 9.95, Escazú centro around 9.917, San Antonio down at 9.90, and the
// climb between them is the slow part. Three legs is a plan someone executes on
// three afternoons; one 33-stop loop is a plan abandoned halfway.
//
// The obvious cut is the register's DISTRITO field, and it is wrong. That field
// is where a school is FILED, not where it stands: True North is filed under San
// Antonio and sits up at 9.931 near the centro, so a district-cut leg sent the
// driver 3 km north and straight back for one stop. So the whole canton is
// ordered as one path first, and the legs are cut at the longest hops in it —
// which are exactly the climbs between the three towns. Each leg then gets its
// name from the districts its stops actually fall in.
//
// ── WHAT THE ORDERING IS AND IS NOT ────────────────────────────────────────
// Stops are ordered by STRAIGHT-LINE distance (nearest-neighbour seeded from the
// leg's southernmost school, then 2-opt until it stops improving). That is a
// visiting ORDER, not a driving route: it does not know about one-way streets,
// the Próspero Fernández, or which quebrada has no bridge. The nav app on the
// dashboard does that part, and does it better. What this file settles is the
// question the nav app cannot answer — which school to point it at next.
//
// Run: `node scripts/build-school-route.mjs`
// Pure Node ESM, Node 20+, zero npm dependencies, no network.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHOOLS_PATH = join(ROOT, "data", "schools.geojson");
const OUT_DIR = join(ROOT, "data", "route");

/**
 * How many afternoons the canton is worth splitting into. Three puts roughly a
 * dozen stops in each, which is about an hour of recording plus the driving
 * between — a session someone finishes rather than abandons.
 */
const LEG_COUNT = 3;

const R_EARTH = 6371000;

function haversine(a, b) {
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

const legLength = (stops) =>
  stops.slice(1).reduce((m, s, i) => m + haversine(stops[i].lonlat, s.lonlat), 0);

/**
 * Nearest-neighbour from the southernmost stop, then 2-opt until no swap helps.
 *
 * An open path, not a loop: the driver ends where the last school is and goes
 * home from there, so paying for a return to the start would be optimising a
 * leg nobody drives. 2-opt is enough at this size — a dozen stops per leg is
 * small enough that it reaches the optimum or within a few percent of it, and
 * the difference is inside the error of ignoring the road network anyway.
 */
function order(stops) {
  if (stops.length < 3) return stops;

  const start = stops.reduce((s, c) => (c.lonlat[1] < s.lonlat[1] ? c : s));
  const remaining = stops.filter((s) => s !== start);
  const path = [start];
  while (remaining.length) {
    const last = path.at(-1);
    let bestI = 0;
    let bestD = Infinity;
    remaining.forEach((s, i) => {
      const d = haversine(last.lonlat, s.lonlat);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    path.push(remaining.splice(bestI, 1)[0]);
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const candidate = [
          ...path.slice(0, i),
          ...path.slice(i, j + 1).reverse(),
          ...path.slice(j + 1),
        ];
        if (legLength(candidate) < legLength(path) - 0.01) {
          path.splice(0, path.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return path;
}

/**
 * A Waze deep link for one stop.
 *
 * `ll` + `navigate=yes` rather than a search string, on purpose: Waze's search
 * would have to guess which "Escuela Corazón de Jesús" is meant (there are two
 * in this metro area alone, and the register knows it), while a coordinate is
 * unambiguous. Waze routes one stop at a time — it has no multi-stop URL — so
 * the route lives in the sheet's ordering and Waze does each hop.
 */
const wazeLink = (s) =>
  `https://waze.com/ul?ll=${s.lonlat[1].toFixed(6)},${s.lonlat[0].toFixed(6)}&navigate=yes`;

/** One Google Maps link per stop, for the same job on a non-Waze phone. */
const mapsPin = (s) =>
  `https://www.google.com/maps/search/?api=1&query=${s.lonlat[1].toFixed(6)},${s.lonlat[0].toFixed(6)}`;

/**
 * Google Maps `dir/` links, batched. One link per ~10 stops: the URL form takes
 * more, but Maps quietly drops the tail on a long one, and a link that silently
 * loses the last four schools is worse than four links that all work.
 */
function mapsLinks(stops, perLink = 10) {
  const links = [];
  for (let i = 0; i < stops.length; i += perLink - 1) {
    // Overlap by one, so each link starts where the previous one ended and the
    // driver never has to re-find their place.
    const chunk = stops.slice(i, i + perLink);
    if (chunk.length < 2) break;
    links.push({
      from: chunk[0],
      to: chunk.at(-1),
      count: chunk.length,
      url:
        "https://www.google.com/maps/dir/" +
        chunk.map((s) => `${s.lonlat[1].toFixed(6)},${s.lonlat[0].toFixed(6)}`).join("/"),
    });
  }
  return links;
}

/** The register files districts and localities in caps; the sheet reads them. */
const titled = (raw) =>
  raw
    .toLocaleLowerCase("es")
    .replace(/(^|[\s/-])([a-záéíóúñ])/g, (_, pre, ch) => pre + ch.toLocaleUpperCase("es"));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ------------------------------------------------------------------- main */

const schools = JSON.parse(readFileSync(SCHOOLS_PATH, "utf8"));
const stops = schools.features.map((f) => ({
  id: f.properties.id,
  name: f.properties.display_name,
  sector: f.properties.sector,
  district: (f.properties.district ?? "").toUpperCase(),
  locality: f.properties.locality,
  mep: f.properties.mep_code,
  address: f.properties.address,
  level: f.properties.level,
  // Hosted programmes at the same address. Worth showing a driver: it is the
  // difference between one stop and three registry entries captured at once.
  alsoHere: f.properties.programmes
    .filter((pr) => pr.code !== f.properties.mep_code)
    .map((pr) => pr.display_name),
  lonlat: f.geometry.coordinates,
}));

// One path over the whole canton, then cut into LEG_COUNT contiguous legs.
// Cutting an already-good path keeps each leg contiguous and keeps the global
// order sane, which a per-cluster ordering does not guarantee.
//
// The cut is BALANCED FIRST, longest-hop second. Cutting purely at the longest
// hops reads well and plans badly: the single worst hop in this canton is the
// one out to Blue Valley at the end of the path, so a pure longest-hop cut
// produced a "leg" of one school. Each boundary is therefore aimed at an even
// share of the stops, then slid inside a window around that mark to whichever
// hop is longest — so the seams still land on the climbs between the towns,
// without handing anyone a one-stop afternoon.
const full = order(stops);
const hopAt = (i) => haversine(full[i - 1].lonlat, full[i].lonlat);
const window = Math.max(1, Math.round(full.length / (LEG_COUNT * 3)));
const hops = [];
for (let k = 1; k < LEG_COUNT; k++) {
  const target = Math.round((k * full.length) / LEG_COUNT);
  let best = target;
  for (let i = Math.max(1, target - window); i <= Math.min(full.length - 1, target + window); i++) {
    if (hopAt(i) > hopAt(best)) best = i;
  }
  hops.push(best);
}
hops.sort((a, b) => a - b);

const legs = [0, ...hops].map((from, i) => {
  const legStops = full.slice(from, hops[i] ?? full.length);
  // Name the leg after the districts its stops are actually in, most common
  // first, so the sheet reads in the vocabulary the driver already uses.
  const byDistrict = new Map();
  for (const s of legStops) byDistrict.set(s.district, (byDistrict.get(s.district) ?? 0) + 1);
  // Name a leg the way a driver would: where it starts and where it ends. The
  // full district roll-call was accurate and unusable — "San Antonio / Escazú /
  // San Rafael — El Carmen, Chiverral, San Antonio" is not something you read
  // at a traffic light. The dominant district rides along as the subtitle.
  const where = (s) => titled(s.locality ?? s.district ?? s.name);
  const span = `${where(legStops[0])} → ${where(legStops.at(-1))}`;
  const districts = [...byDistrict.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([d]) => titled(d));
  return { title: span, districts, stops: legStops };
});

const covered = legs.reduce((n, l) => n + l.stops.length, 0);
if (covered !== stops.length) {
  throw new Error(`route drops schools: ${covered} of ${stops.length} on the sheet`);
}

mkdirSync(OUT_DIR, { recursive: true });

/* --- GPX ---------------------------------------------------------------- */
const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="streetlens/build-school-route" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Escazú schools — field collection route</name>
    <desc>Every centro educativo in the canton, ${stops.length} sites, grouped into ${legs.length} driving legs. Roster from the MEP SIGMEP register; see data/schools.geojson for per-site provenance.</desc>
  </metadata>
${stops
  .map(
    (s) => `  <wpt lat="${s.lonlat[1].toFixed(6)}" lon="${s.lonlat[0].toFixed(6)}">
    <name>${esc(s.name)}</name>
    <desc>${esc(`${s.sector === "public" ? "Público" : "Privado"}${s.mep ? ` · MEP ${s.mep}` : ""}${s.address ? ` · ${s.address}` : ""}`)}</desc>
    <sym>School</sym>
  </wpt>`,
  )
  .join("\n")}
${legs
  .filter((l) => l.stops.length)
  .map(
    (l) => `  <rte>
    <name>${esc(`Leg ${legs.indexOf(l) + 1} - ${l.title}`)}</name>
${l.stops
  .map(
    (s, i) => `    <rtept lat="${s.lonlat[1].toFixed(6)}" lon="${s.lonlat[0].toFixed(6)}"><name>${esc(`${i + 1}. ${s.name}`)}</name></rtept>`,
  )
  .join("\n")}
  </rte>`,
  )
  .join("\n")}
</gpx>
`;
writeFileSync(join(OUT_DIR, "school-route.gpx"), gpx);

/* --- GeoJSON ------------------------------------------------------------ */
const routeGeo = {
  type: "FeatureCollection",
  metadata: {
    title: "Escazú schools — field collection route",
    generated_by: "scripts/build-school-route.mjs",
    ordering: "nearest-neighbour + 2-opt on straight-line distance; a visiting order, not a driving route",
    legs: legs.map((l) => ({
      title: l.title,
      districts: l.districts,
      stops: l.stops.length,
      straight_line_km: Number((legLength(l.stops) / 1000).toFixed(2)),
    })),
  },
  features: [
    ...legs.flatMap((l, li) =>
      l.stops.map((s, i) => ({
        type: "Feature",
        id: `${s.id}-stop`,
        geometry: { type: "Point", coordinates: s.lonlat },
        properties: {
          school_id: s.id,
          name: s.name,
          sector: s.sector,
          level: s.level,
          mep_code: s.mep,
          also_here: s.alsoHere,
          address: s.address,
          waze: wazeLink(s),
          maps: mapsPin(s),
          leg: li + 1,
          leg_title: l.title,
          stop: i + 1,
          // Straight-line hop from the previous stop on this leg. Not the road
          // distance — it is the "how far is the next one" a driver actually
          // asks, at the accuracy that question deserves.
          hop_from_previous_m: i === 0 ? null : Math.round(haversine(l.stops[i - 1].lonlat, s.lonlat)),
        },
      })),
    ),
    ...legs
      .filter((l) => l.stops.length > 1)
      .map((l, li) => ({
        type: "Feature",
        id: `leg-${li + 1}`,
        geometry: { type: "LineString", coordinates: l.stops.map((s) => s.lonlat) },
        properties: { leg: li + 1, leg_title: l.title, stops: l.stops.length },
      })),
  ],
};
writeFileSync(join(OUT_DIR, "school-route.geojson"), JSON.stringify(routeGeo, null, 2) + "\n");

/* --- run sheet ---------------------------------------------------------- */
const totalKm = legs.reduce((m, l) => m + legLength(l.stops), 0) / 1000;
const md = [
  "# Escazú schools — field collection route",
  "",
  `${stops.length} sites, ${legs.filter((l) => l.stops.length).length} legs, ${totalKm.toFixed(1)} km of straight-line hops.`,
  "",
  "Generated by `node scripts/build-school-route.mjs` from `data/schools.geojson`.",
  "Roster is the MEP SIGMEP register; every site's provenance is in that file.",
  "",
  "**The order is a visiting order, not a driving route.** It ignores one-way",
  "streets, the Próspero Fernández, and which quebrada has no bridge. Point the",
  "nav app at the next stop and let it find the road; what this settles is which",
  "stop is next.",
  "",
  "**Waze takes one stop at a time** — it has no multi-stop URL. So the route is",
  "the ORDER in this sheet: tap the next school's Waze link when you finish the",
  "last one. The Google Maps link at the foot of each leg does carry the whole",
  "leg at once, if you would rather see it as one line.",
  "",
  "Files: `school-route.gpx` (waypoints + one route per leg, for OsmAnd / Gaia /",
  "Garmin), `school-route.geojson` (the same thing for a map).",
  "",
];
for (const [li, l] of legs.filter((x) => x.stops.length).entries()) {
  md.push(`## Leg ${li + 1} — ${l.title}`);
  md.push("");
  md.push(`${l.districts.join(" / ")} · ${l.stops.length} stops · ${(legLength(l.stops) / 1000).toFixed(1)} km straight-line`);
  md.push("");
  md.push("| # | School | Sector | Address | Coordinates | Navigate |");
  md.push("| --: | --- | --- | --- | --- | --- |");
  l.stops.forEach((s, i) => {
    md.push(
      `| ${i + 1} | **${s.name}**<br>\`${s.mep ?? "—"}\` | ${s.sector === "public" ? "Público" : "Privado"} | ${s.address ?? "—"} | \`${s.lonlat[1].toFixed(6)}, ${s.lonlat[0].toFixed(6)}\` | [Waze](${wazeLink(s)}) · [Maps](${mapsPin(s)}) |`,
    );
  });
  md.push("");
  const links = mapsLinks(l.stops);
  md.push(`**Whole leg in Google Maps** (${links.length} link${links.length === 1 ? "" : "s"}, split so none drops its tail):`);
  md.push("");
  links.forEach((lk, i) => {
    md.push(`${i + 1}. [${lk.from.name} → ${lk.to.name} (${lk.count} stops)](${lk.url})`);
  });
  md.push("");
}
writeFileSync(join(OUT_DIR, "SCHOOL-ROUTE.md"), md.join("\n"));

console.log("Escazú schools — field collection route\n");
for (const [li, l] of legs.filter((x) => x.stops.length).entries()) {
  console.log(
    `Leg ${li + 1} — ${l.title}\n  ${l.stops.length} stops · ${(legLength(l.stops) / 1000).toFixed(1)} km straight-line`,
  );
  l.stops.forEach((s, i) =>
    console.log(
      `   ${String(i + 1).padStart(2)}. ${s.name.slice(0, 46).padEnd(46)} ${s.lonlat[1].toFixed(6)}, ${s.lonlat[0].toFixed(6)}`,
    ),
  );
  console.log("");
}
console.log(`${stops.length} sites · ${totalKm.toFixed(1)} km straight-line total`);
console.log(`wrote ${OUT_DIR}/{school-route.gpx, school-route.geojson, SCHOOL-ROUTE.md}`);
