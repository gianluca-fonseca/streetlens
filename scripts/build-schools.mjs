// scripts/build-schools.mjs
//
// Builds data/schools.geojson: every school in the Escazú canton, public and
// private, as one point per PHYSICAL SITE.
//
// Provenance is the whole point of this file. The roster is the MEP's own
// register — the same register that decides whether a centro educativo legally
// exists — and OpenStreetMap is used only to sharpen a position and to catch
// sites the register places badly. Nothing here is hand-typed from memory.
//
//   roster + sector + district   MEP SIGMEP ArcGIS feature services
//                                  MEP_CEPUBCR_1  (centros educativos públicos)
//                                  MEP_CEPRIVCR_1 (centros educativos privados)
//                                Attribution: SIGMEP, Ministerio de Educación
//                                Pública de Costa Rica.
//   position refinement          OpenStreetMap via Overpass (ODbL). A campus
//                                way's centroid sits on the campus; the MEP
//                                point is a single surveyed pin that can land on
//                                a neighbouring lot. Where the two agree within
//                                MATCH_RADIUS_M the OSM centroid wins.
//   canton boundary              OSM relation 4071270 (Escazú, admin_level 6),
//                                used to test whether a registry point is
//                                actually inside the canton it claims.
//
// Run: `node scripts/build-schools.mjs`   (network required, ~30s)
//      `node scripts/build-schools.mjs --dry`  prints the reconciliation only.
//
// Pure Node ESM, Node 20+, zero npm dependencies.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "data", "schools.geojson");
/* Overpass is flaky enough that iterating on the emit step without `--cache`
 * means waiting on retries for a payload that has not changed. Gitignored. */
const CACHE_DIR = join(ROOT, ".cache", "schools");

/* Overpass 406s an unidentified client (Node's default User-Agent is one), and
 * the main instance 504s under load often enough that a single attempt is not a
 * build step. Identify, retry, then fall through to the mirrors. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "streetlens-build-schools/1.0 (https://github.com/filippo-fonseca/streetlens)";
const SIGMEP = "https://sig.mep.go.cr/server/rest/services";
const CANTON_RELATION = 4071270;

/** OSM and MEP are called a match inside this radius when their names share a
 *  token, or unconditionally inside NEAR_RADIUS_M. Both are well under the
 *  ~200m spacing of the closest two distinct sites in the canton (Liceo de
 *  Escazú and Benjamín Herrera Angulo sit 96m apart), so the matcher can never
 *  silently fuse two schools into one pin. */
const MATCH_RADIUS_M = 400;
const NEAR_RADIUS_M = 90;

/** Two registry rows are the same physical site inside this radius. Co-located
 *  rows are real: CINDEA and CONED are adult programmes that run inside an
 *  existing school, and a J.N. (jardín de niños) is usually an annex of the
 *  escuela it is named after. They become `programmes` on one pin rather than a
 *  stack of pins nobody can click apart. */
const SITE_RADIUS_M = 40;

/*
 * Registry rows this build deliberately drops, each with the evidence. Kept in
 * the source rather than applied by hand so a re-run cannot quietly re-admit
 * them, and so a reviewer can argue with the reasoning.
 */
const EXCLUDE = [
  {
    match: (r) => /JAIM WEIZMAN/i.test(r.name),
    why:
      "MEP files it under canton Escazú, but its registry coordinate " +
      "(9.9347, -84.1189) falls ~2 km east of the canton line, and OSM puts the " +
      "school on Boulevard Rohrmoser in Pavas, canton San José. The CANTON " +
      "field is wrong, not the geometry.",
  },
];

/*
 * OSM features inside the canton that the registry does not carry. Admitted one
 * by one, never in bulk: an untagged-as-stale OSM school is exactly how a
 * school-safety map ends up recommending an intervention at a site that closed.
 */
const OSM_ONLY_ADMIT = {
  "way/1303988283": {
    sector: "public",
    level: "preschool",
    note:
      "Jardín de Niños Corazón de Jesús — the MEP preschool annex ~70 m from " +
      "Escuela Corazón de Jesús, tagged operator=MEP / operator:type=public in " +
      "OSM. The register folds it into the escuela's row; it is its own site.",
  },
};

/*
 * OSM features inside the canton that are NOT admitted, with the reason. Same
 * argument as EXCLUDE: write the reasoning down or re-run it by hand forever.
 */
const OSM_ONLY_REJECT = {
  "way/172346243":
    "Country Day School moved to San Rafael de Alajuela in 2016 (MEP registers " +
    "it there, canton Alajuela). The Escazú site is now the Centro Cívico " +
    "Municipal. The OSM feature is stale.",
};

/* ---------------------------------------------------------------- helpers */

const R_EARTH = 6371000;

function haversine(a, b) {
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Fold accents and the generic head-noun every centro educativo shares, so
 *  "CENTRO EDUCATIVO ARANDÚ" and "Arandú" leave a token in common. */
function nameTokens(s) {
  const flat = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(
      /\b(centro educativo|colegio|escuela|liceo|jardin infantil|jardin de ninos|instituto|school|c\.?e\.?)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return new Set(flat.split(" ").filter((t) => t.length > 2));
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const useCache = process.argv.includes("--cache");

/** Memoise one upstream response on disk, keyed by the request that produced it. */
async function cached(key, fetcher) {
  const file = join(CACHE_DIR, `${createHash("sha1").update(key).digest("hex").slice(0, 16)}.json`);
  if (useCache && existsSync(file)) {
    console.log("  (cache hit)");
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const value = await fetcher();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return value;
}

async function overpass(query) {
  return cached(`overpass:${query}`, () => overpassLive(query));
}

async function overpassLive(query) {
  let last = "";
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length * 2; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) return res.json();
      last = `${endpoint} → ${res.status}`;
    } catch (err) {
      last = `${endpoint} → ${err.message}`;
    }
    console.log("  retry (%s)", last);
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Overpass unavailable: ${last}`);
}

async function sigmep(service) {
  return cached(`sigmep:${service}`, () => sigmepLive(service));
}

async function sigmepLive(service) {
  const params = new URLSearchParams({
    where: "UPPER(CANTON) LIKE '%ESCAZ%'",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const res = await fetch(`${SIGMEP}/${service}/MapServer/0/query?${params}`);
  if (!res.ok) throw new Error(`SIGMEP ${service} ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`SIGMEP ${service}: ${json.error.message}`);
  return json.features ?? [];
}

/* ----------------------------------------------------------- display name */

/* Particles that stay lowercase inside a Spanish proper name. */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "el", "y", "e"]);
/* Tokens that are already correctly cased and must survive untouched. */
/* Roman numerals need 2+ chars and an acronym needs a period, so the lone
 * Spanish conjunction "E" is not mistaken for one. */
const KEEP_UPPER = /^(?:[IVXLCDM]{2,}|[A-Z](?:\.[A-Z])+\.?|CINDEA|CONED|MEP|IEGB|CTP|SEK|UCR|UNA|INA)$/;

/**
 * The register writes every name in caps. Caps is a filing convention, not a
 * name, and thirty-three shouting labels on a map is unreadable — so pins carry
 * a cased `display_name` while `name` keeps the registry string verbatim, which
 * is the one a partner will match against an MEP spreadsheet.
 *
 * Acronyms (C.T.P., I.E.G.B., J.N., CINDEA) and roman numerals (Juan XXIII)
 * are left alone; particles drop to lowercase unless they open the name or
 * follow a bracket.
 */
function displayName(raw) {
  let openers = true;
  return (raw ?? "")
    .split(/(\s+|[()/])/)
    .map((tok) => {
      if (!tok.trim() || /^[()/]$/.test(tok)) {
        if (/^[(/]$/.test(tok)) openers = true;
        return tok;
      }
      if (KEEP_UPPER.test(tok)) {
        openers = false;
        return tok;
      }
      const lower = tok.toLocaleLowerCase("es");
      const cased =
        PARTICLES.has(lower) && !openers
          ? lower
          : lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
      openers = false;
      return cased;
    })
    .join("");
}

/* ------------------------------------------------------------------ level */

/*
 * Education level, and ONLY where the source states it. MEP encodes the level in
 * the registered name (a "LICEO" is secondary, a "J.N." is a jardín de niños,
 * "C.T.P." is a técnico profesional, "I.E.G.B." runs básica general), and OSM
 * sometimes carries an explicit `grades` tag. Everything else stays null rather
 * than guessed: a private "Centro Educativo X" can be a daycare or a K-12, and
 * the whole value of this file to a school-zone argument is that the youngest
 * cohort is not inferred.
 */
function levelFrom(mepName, osmTags) {
  const n = (mepName ?? "").toUpperCase();
  if (/^J\.?N\.?\b|JARD[IÍ]N INFANTIL|JARD[IÍ]N DE NI/.test(n)) return "preschool";
  if (/^LICEO\b|C\.?T\.?P\.?\b|HIGH SCHOOL/.test(n)) return "secondary";
  if (/I\.?E\.?G\.?B\.?/.test(n)) return "basica_general";
  if (/^CINDEA|^CONED/.test(n)) return "adult";

  const grades = osmTags?.grades;
  if (typeof grades === "string") {
    const m = grades.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (hi <= 6) return lo === 0 ? "preschool_primary" : "primary";
      if (lo >= 7) return "secondary";
      return "basica_general";
    }
  }
  return null;
}

/* ------------------------------------------------------------------- main */

const dryRun = process.argv.includes("--dry");

console.log("→ canton boundary (OSM relation %d)", CANTON_RELATION);
const boundary = await overpass(
  `[out:json][timeout:120];rel(${CANTON_RELATION});out geom;`,
);

// Stitch the relation's outer ways into one ring. Overpass hands them back in
// arbitrary order and orientation, so walk from the running end each time.
const pieces = boundary.elements
  .flatMap((e) => e.members ?? [])
  .filter((m) => m.geometry && (m.role === "outer" || m.role === ""))
  .map((m) => m.geometry.map((g) => [g.lon, g.lat]));
let ring = pieces.shift();
while (pieces.length) {
  const i = pieces.findIndex((p) => haversine(ring.at(-1), p[0]) < 1);
  const j = i < 0 ? pieces.findIndex((p) => haversine(ring.at(-1), p.at(-1)) < 1) : -1;
  if (i >= 0) ring = ring.concat(pieces.splice(i, 1)[0].slice(1));
  else if (j >= 0) ring = ring.concat(pieces.splice(j, 1)[0].reverse().slice(1));
  else ring = ring.concat(pieces.shift());
}
const lats = ring.map((p) => p[1]);
const lons = ring.map((p) => p[0]);
const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
console.log("  ring %d pts, bbox %s", ring.length, bbox.map((n) => n.toFixed(4)).join(","));

console.log("→ MEP SIGMEP register (público + privado, canton Escazú)");
const registry = [];
for (const [service, sector] of [
  ["MEP_CEPUBCR_1", "public"],
  ["MEP_CEPRIVCR_1", "private"],
]) {
  const feats = await sigmep(service);
  console.log("  %s → %d rows", service, feats.length);
  for (const f of feats) {
    const p = f.properties;
    registry.push({
      code: p.CODSABER,
      name: p.CENTRO_EDU,
      sector,
      district: p.DISTRITO,
      locality: p.POBLADO ?? null,
      circuit: p.CIRCUITO ?? null,
      region: p.REGIONAL ?? null,
      lonlat: f.geometry.coordinates,
      service,
    });
  }
}

console.log("→ OSM education features in the canton bbox");
const osmRaw = await overpass(`[out:json][timeout:120];
(
  nwr["amenity"~"^(school|kindergarten|college)$"](${bbox.join(",")});
  nwr["building"="school"](${bbox.join(",")});
);
out center tags;`);

const osm = [];
for (const e of osmRaw.elements) {
  const tags = e.tags ?? {};
  if (!tags.name) continue;
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (lat == null || !pointInRing([lon, lat], ring)) continue;
  osm.push({ ref: `${e.type}/${e.id}`, name: tags.name, lonlat: [lon, lat], tags });
}
console.log("  %d named education features inside the canton", osm.length);

/* --- drop the rows the register places outside the canton it claims ------- */
const dropped = [];
const kept = registry.filter((r) => {
  const rule = EXCLUDE.find((x) => x.match(r));
  if (rule) {
    dropped.push({ ...r, why: rule.why });
    return false;
  }
  return true;
});

/* --- match each registry row to at most one OSM feature ------------------- */
const claimed = new Set();
for (const r of kept) {
  let best = null;
  let bestD = Infinity;
  for (const o of osm) {
    const d = haversine(r.lonlat, o.lonlat);
    if (d >= MATCH_RADIUS_M || d >= bestD) continue;
    const shared = [...nameTokens(r.name)].some((t) => nameTokens(o.name).has(t));
    if (shared || d < NEAR_RADIUS_M) {
      best = o;
      bestD = d;
    }
  }
  if (best) {
    r.osm = best;
    r.osmDist = Math.round(bestD);
    claimed.add(best.ref);
  }
}

/* --- collapse co-located registry rows into one physical site ------------- */
const sites = [];
for (const r of kept) {
  const anchor = r.osm ? r.osm.lonlat : r.lonlat;
  const site = sites.find(
    (s) => s.sector === r.sector && haversine(s.anchor, anchor) < SITE_RADIUS_M,
  );
  if (site) {
    site.rows.push(r);
    if (!site.osm && r.osm) {
      site.osm = r.osm;
      site.osmDist = r.osmDist;
      site.anchor = r.osm.lonlat;
    }
  } else {
    sites.push({ sector: r.sector, anchor, osm: r.osm ?? null, osmDist: r.osmDist, rows: [r] });
  }
}

/* --- admit the vetted OSM-only sites ------------------------------------- */
const osmOnly = osm.filter((o) => !claimed.has(o.ref));
for (const o of osmOnly) {
  const admit = OSM_ONLY_ADMIT[o.ref];
  if (!admit) continue;
  sites.push({ sector: admit.sector, anchor: o.lonlat, osm: o, osmDist: 0, rows: [], admit });
}

/* --- emit ---------------------------------------------------------------- */
const features = sites
  .map((s) => {
    // The row whose name is not a hosted programme is the site's identity.
    const primary =
      s.rows.find((r) => !/^CINDEA|^CONED|^J\.?N\.?\b/.test(r.name.toUpperCase())) ??
      s.rows[0];
    const registryName = primary ? primary.name : s.osm.name;
    const positionSource = s.osm ? "osm" : "mep";
    const id = primary
      ? `school-${primary.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      : `school-osm-${s.osm.ref.replace("/", "-")}`;

    return {
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: s.anchor.map((n) => Number(n.toFixed(6))) },
      properties: {
        id,
        name: registryName,
        display_name: primary ? displayName(registryName) : registryName,
        sector: s.sector,
        level: primary ? levelFrom(primary.name, s.osm?.tags) : (s.admit?.level ?? null),
        district: primary?.district ?? s.osm?.tags?.["addr:city"] ?? null,
        locality: primary?.locality ?? null,
        mep_code: primary?.code ?? null,
        mep_circuit: primary?.circuit ?? null,
        mep_region: primary?.region ?? null,
        // Every registry row that runs at this site, hosted programmes included.
        programmes: s.rows.map((r) => ({
          code: r.code,
          name: r.name,
          display_name: displayName(r.name),
          level: levelFrom(r.name, s.osm?.tags),
        })),
        osm_ref: s.osm?.ref ?? null,
        osm_name: s.osm?.name ?? null,
        website: s.osm?.tags?.website ?? null,
        // How this pin got its coordinate, and how far the two sources sat
        // apart. A large gap is a field-check candidate, not an error to hide.
        position_source: positionSource,
        position_delta_m: s.osm && s.rows.length ? (s.osmDist ?? null) : null,
        registry: s.rows.length ? "mep" : "osm",
        registry_note: s.admit?.note ?? null,
      },
    };
  })
  .sort((a, b) =>
    a.properties.sector === b.properties.sector
      ? a.properties.display_name.localeCompare(b.properties.display_name, "es")
      : a.properties.sector.localeCompare(b.properties.sector),
  );

const collection = {
  type: "FeatureCollection",
  metadata: {
    title: "Centros educativos del cantón de Escazú",
    generated_by: "scripts/build-schools.mjs",
    canton: "Escazú",
    canton_osm_relation: CANTON_RELATION,
    counts: {
      sites: features.length,
      public: features.filter((f) => f.properties.sector === "public").length,
      private: features.filter((f) => f.properties.sector === "private").length,
      registry_rows: kept.length,
      positioned_from_osm: features.filter((f) => f.properties.position_source === "osm").length,
    },
    sources: [
      {
        id: "mep-sigmep",
        name: "SIGMEP — Sistema de Información Geográfica, Ministerio de Educación Pública de Costa Rica",
        services: ["MEP_CEPUBCR_1", "MEP_CEPRIVCR_1"],
        url: SIGMEP,
        role: "roster, sector, district, MEP code",
      },
      {
        id: "osm",
        name: "OpenStreetMap contributors",
        licence: "ODbL",
        role: "campus centroid refinement, canton boundary",
      },
    ],
    excluded: dropped.map((d) => ({ code: d.code, name: d.name, why: d.why })),
    osm_rejected: Object.entries(OSM_ONLY_REJECT).map(([ref, why]) => ({ ref, why })),
  },
  features,
};

console.log("\n=== sites ===");
for (const f of features) {
  const p = f.properties;
  const extra = p.programmes.length > 1 ? ` +${p.programmes.length - 1} programme` : "";
  console.log(
    "  %s  %s %s %s%s",
    p.sector === "public" ? "PUB" : "pri",
    p.display_name.slice(0, 50).padEnd(50),
    (p.level ?? "—").padEnd(18),
    (p.district ?? "").padEnd(12),
    extra,
  );
}
console.log("\n=== excluded registry rows ===");
for (const d of dropped) console.log("  %s — %s", d.name, d.why);
console.log("\n=== OSM inside canton, not in the register ===");
for (const o of osmOnly) {
  const verdict = OSM_ONLY_ADMIT[o.ref] ? "ADMITTED" : OSM_ONLY_REJECT[o.ref] ? "rejected" : "UNREVIEWED";
  console.log("  [%s] %s %s", verdict, o.ref, o.name);
}
console.log(
  "\n%d sites — %d public, %d private, %d positioned from OSM",
  features.length,
  collection.metadata.counts.public,
  collection.metadata.counts.private,
  collection.metadata.counts.positioned_from_osm,
);

if (dryRun) {
  console.log("\n--dry: nothing written");
} else {
  writeFileSync(OUT_PATH, JSON.stringify(collection, null, 2) + "\n");
  console.log("\nwrote %s", OUT_PATH);
}
