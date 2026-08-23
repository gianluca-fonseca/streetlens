/**
 * School data-access layer — the roster of centros educativos in the canton.
 *
 * One point per PHYSICAL SITE, not per registry row: the MEP register carries
 * hosted programmes (CINDEA, CONED, a jardín de niños annex) as separate rows at
 * the same address, and those arrive here folded into `programmes` so the map
 * shows one clickable pin per place a child actually walks to.
 *
 * The file is generated, never hand-edited — `node scripts/build-schools.mjs`
 * rebuilds it from the MEP's SIGMEP register plus OpenStreetMap. Every exclusion
 * and every OSM-only admission is argued in that script and echoed into
 * `metadata`, because the whole point of this layer is that a partner can ask
 * "where did this school come from?" and get an answer.
 *
 * Read from disk only. Unlike segments there is no Supabase mirror: the roster
 * changes when the MEP register changes, which is a rebuild, not a write path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const SCHOOLS_PATH = path.join(process.cwd(), "data", "schools.geojson");

/** Which register the site belongs to. */
export type SchoolSector = "public" | "private";

/**
 * Education level, and ONLY where a source states it. Left `null` rather than
 * guessed: a "Centro Educativo X" in the private register can be a daycare or a
 * K-12, and a school-zone argument that infers the age of the children walking
 * there is exactly the kind of imprecision this project cannot afford.
 */
export type SchoolLevel =
  | "preschool"
  | "primary"
  | "preschool_primary"
  | "secondary"
  | "basica_general"
  | "adult";

/** One registry row running at a site (the site itself, or a hosted programme). */
export type SchoolProgramme = {
  /** MEP código SABER, the id a partner can match against an MEP spreadsheet. */
  code: string;
  /** Verbatim registry string (the MEP writes every name in caps). */
  name: string;
  /** The same name cased for reading. */
  display_name: string;
  level: SchoolLevel | null;
};

export type SchoolProperties = {
  id: string;
  /** Verbatim registry string, kept so a partner can match it against the MEP's
   *  own list. Shouty by construction — render `display_name` instead. */
  name: string;
  /** The registry name cased for reading; what every label and popup shows. */
  display_name: string;
  sector: SchoolSector;
  level: SchoolLevel | null;
  district: string | null;
  locality: string | null;
  mep_code: string | null;
  mep_circuit: string | null;
  mep_region: string | null;
  programmes: SchoolProgramme[];
  osm_ref: string | null;
  osm_name: string | null;
  website: string | null;
  /** Which source gave this pin its coordinate: an OSM campus centroid, or the
   *  MEP's own surveyed point when OSM has no matching feature. */
  position_source: "osm" | "mep";
  /** How far apart the two sources put this site, in metres. A large gap is a
   *  field-check candidate, not an error to paper over. */
  position_delta_m: number | null;
  /** `mep` for a registered centro educativo, `osm` for a vetted OSM-only site. */
  registry: "mep" | "osm";
  registry_note: string | null;
};

export type SchoolFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: SchoolProperties;
};

export type SchoolSource = {
  id: string;
  name: string;
  services?: string[];
  url?: string;
  licence?: string;
  role: string;
};

export type SchoolCollection = {
  type: "FeatureCollection";
  metadata: {
    title: string;
    generated_by: string;
    canton: string;
    canton_osm_relation: number;
    counts: {
      sites: number;
      public: number;
      private: number;
      registry_rows: number;
      positioned_from_osm: number;
    };
    sources: SchoolSource[];
    excluded: { code: string; name: string; why: string }[];
    osm_rejected: { ref: string; why: string }[];
  };
  features: SchoolFeature[];
};

const EMPTY: SchoolCollection = {
  type: "FeatureCollection",
  metadata: {
    title: "",
    generated_by: "scripts/build-schools.mjs",
    canton: "",
    canton_osm_relation: 0,
    counts: {
      sites: 0,
      public: 0,
      private: 0,
      registry_rows: 0,
      positioned_from_osm: 0,
    },
    sources: [],
    excluded: [],
    osm_rejected: [],
  },
  features: [],
};

let cached: Promise<SchoolCollection> | null = null;

/**
 * The canton's schools. Cached per process — the file is committed and static,
 * so re-reading it per request buys nothing.
 *
 * A missing or unparseable file yields an EMPTY collection rather than throwing:
 * the schools overlay is an addition to the map, and a build that has not run
 * `scripts/build-schools.mjs` yet should render a map without pins, not a 500.
 */
export function getSchools(): Promise<SchoolCollection> {
  cached ??= fs
    .readFile(SCHOOLS_PATH, "utf8")
    .then((raw) => JSON.parse(raw) as SchoolCollection)
    .catch((err) => {
      console.warn("[schools] falling back to empty roster:", (err as Error).message);
      return EMPTY;
    });
  return cached;
}

/** Test seam: drop the per-process cache. */
export function resetSchoolsCache(): void {
  cached = null;
}
