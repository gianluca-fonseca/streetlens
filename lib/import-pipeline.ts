/**
 * Bulk-import parsing + validation (advisor ruling 4) — PURE and node-testable.
 *
 * No Next.js, no fs, no side effects: given file text it parses GeoJSON or CSV
 * into raw features, and given raw features + the set of existing segment ids it
 * produces a per-row validation preview. The API route (app/api/admin/import)
 * wires these to the session guard, the live segment ids, and the apply pipeline.
 */

import { importFeatureSchema, type ImportFeature } from "./schemas";

/** Generous Escazú-area bounding box; features outside are flagged, not blocked. */
export const ESCAZU_BBOX = {
  minLng: -84.2,
  maxLng: -84.02,
  minLat: 9.84,
  maxLat: 9.99,
};

export type IssueCode = "bbox" | "duplicate" | "schema";
export type Issue = { code: IssueCode; message?: string };
export type PreviewRow = {
  index: number;
  name: string | null;
  highway: string | null;
  status: "valid" | "invalid" | "duplicate";
  issues: Issue[];
};
export type ImportSummary = {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  outOfBounds: number;
};

/** A raw, unvalidated feature parsed from GeoJSON or CSV. */
export type RawFeature = {
  id?: string;
  name?: string;
  highway?: string;
  coordinates?: number[][];
};

export type Evaluated = { row: PreviewRow; feature: ImportFeature | null };

/* ------------------------------------------------------------------ *
 * Parsing (GeoJSON + CSV → RawFeature[])
 * ------------------------------------------------------------------ */

function parseGeoJson(content: string): RawFeature[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    return null;
  }
  const features = (parsed as { features: unknown[] }).features;
  return features.map((f): RawFeature => {
    const feat = (f ?? {}) as {
      properties?: Record<string, unknown> | null;
      geometry?: { type?: unknown; coordinates?: unknown } | null;
    };
    const props = feat.properties ?? {};
    const geom = feat.geometry ?? {};
    const idRaw = props.id;
    return {
      id:
        typeof idRaw === "string"
          ? idRaw
          : typeof idRaw === "number"
            ? String(idRaw)
            : undefined,
      name: typeof props.name === "string" ? props.name : undefined,
      highway: typeof props.highway === "string" ? props.highway : undefined,
      coordinates:
        geom.type === "LineString" && Array.isArray(geom.coordinates)
          ? (geom.coordinates as number[][])
          : undefined,
    };
  });
}

/** Minimal quote-aware CSV line splitter (handles "quoted, fields" and ""). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse a `lng lat;lng lat;...` cell into positions. */
function parseCoordsCell(cell: string): number[][] {
  return cell
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split(/\s+/).map(Number));
}

function parseCsv(content: string): RawFeature[] | null {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const iName = header.indexOf("name");
  const iHighway = header.indexOf("highway");
  const iCoords = header.indexOf("coordinates");
  const iId = header.indexOf("id");
  if (iName < 0 || iHighway < 0 || iCoords < 0) return null;

  return lines.slice(1).map((line): RawFeature => {
    const cells = splitCsvLine(line);
    return {
      id: iId >= 0 && cells[iId] ? cells[iId] : undefined,
      name: cells[iName],
      highway: cells[iHighway],
      coordinates: cells[iCoords] ? parseCoordsCell(cells[iCoords]) : undefined,
    };
  });
}

/** Parse an uploaded file into raw features, or null if it isn't parseable. */
export function parseFile(
  content: string,
  filename?: string,
): RawFeature[] | null {
  const isCsv =
    (filename && /\.csv$/i.test(filename)) || !content.trim().startsWith("{");
  return isCsv ? parseCsv(content) : parseGeoJson(content);
}

/* ------------------------------------------------------------------ *
 * Validation (pure)
 * ------------------------------------------------------------------ */

function outOfBbox(coords: readonly (readonly number[])[]): boolean {
  return coords.some(
    (p) =>
      p[0] < ESCAZU_BBOX.minLng ||
      p[0] > ESCAZU_BBOX.maxLng ||
      p[1] < ESCAZU_BBOX.minLat ||
      p[1] > ESCAZU_BBOX.maxLat,
  );
}

/** Validate one raw feature against the schema, existing ids, and the bbox. */
function evaluateOne(
  raw: RawFeature,
  index: number,
  existingIds: Set<string>,
  seenIds: Set<string>,
): Evaluated {
  const parsed = importFeatureSchema.safeParse({
    id: raw.id,
    name: raw.name,
    highway: raw.highway,
    coordinates: raw.coordinates,
  });

  const base = { index, name: raw.name ?? null, highway: raw.highway ?? null };

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      row: {
        ...base,
        status: "invalid",
        issues: [{ code: "schema", message: first?.message ?? "invalid" }],
      },
      feature: null,
    };
  }

  const feature = parsed.data;
  const id = feature.id;
  const isDuplicate =
    !!id &&
    (existingIds.has(id) ||
      existingIds.has(`imp-${id}`) ||
      existingIds.has(`com-${id}`) ||
      seenIds.has(id));
  if (id) seenIds.add(id);

  if (isDuplicate) {
    return {
      row: { ...base, status: "duplicate", issues: [{ code: "duplicate" }] },
      feature: null,
    };
  }

  const issues: Issue[] = outOfBbox(feature.coordinates)
    ? [{ code: "bbox" }]
    : [];
  return { row: { ...base, status: "valid", issues }, feature };
}

/** Validate a batch of raw features against a set of existing segment ids. */
export function evaluateFeatures(
  raw: RawFeature[],
  existingIds: Set<string>,
): Evaluated[] {
  const seenIds = new Set<string>();
  return raw.map((r, i) => evaluateOne(r, i, existingIds, seenIds));
}

/** Tally a preview into the summary chips shown by the import panel. */
export function summarize(rows: PreviewRow[]): ImportSummary {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    outOfBounds: rows.filter((r) => r.issues.some((i) => i.code === "bbox"))
      .length,
  };
}
