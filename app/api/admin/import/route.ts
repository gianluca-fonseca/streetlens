import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { getSegments } from "@/lib/segments";
import { applyImportFeatures } from "@/lib/apply-submissions";
import { importFeatureSchema, type ImportFeature } from "@/lib/schemas";

// Uses fs (segments read + community store) + Web Crypto (session): Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/admin/import — bulk import (advisor ruling 4).
 *
 *   { action: "validate", content, filename? }
 *     → dry-run: per-row validation preview, ZERO side effects.
 *   { action: "commit", content, filename?, verified, auditor? }
 *     → applies the valid, non-duplicate features through the single apply
 *       pipeline (lib/apply-submissions.ts).
 *
 * All validation is server-side. The session is re-verified here independently
 * of the proxy guard (the proxy matcher excludes /api).
 */

/** Generous Escazú-area bounding box; features outside are flagged (not blocked). */
const ESCAZU_BBOX = { minLng: -84.2, maxLng: -84.02, minLat: 9.84, maxLat: 9.99 };
/** Hard cap on a single import to bound work. */
const MAX_FEATURES = 2000;

type IssueCode = "bbox" | "duplicate" | "schema";
type Issue = { code: IssueCode; message?: string };
type PreviewRow = {
  index: number;
  name: string | null;
  highway: string | null;
  status: "valid" | "invalid" | "duplicate";
  issues: Issue[];
};

/** A raw, unvalidated feature parsed from GeoJSON or CSV. */
type RawFeature = {
  id?: string;
  name?: string;
  highway?: string;
  coordinates?: number[][];
};

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
  const col = (name: string) => header.indexOf(name);
  const iName = col("name");
  const iHighway = col("highway");
  const iCoords = col("coordinates");
  const iId = col("id");
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

function parseFile(content: string, filename?: string): RawFeature[] | null {
  const isCsv =
    (filename && /\.csv$/i.test(filename)) || !content.trim().startsWith("{");
  return isCsv ? parseCsv(content) : parseGeoJson(content);
}

/* ------------------------------------------------------------------ *
 * Validation
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

type Evaluated = { row: PreviewRow; feature: ImportFeature | null };

/** Validate one raw feature against the schema, existing ids, and the bbox. */
function evaluate(
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

  const base = {
    index,
    name: raw.name ?? null,
    highway: raw.highway ?? null,
  };

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
  // Dedupe against existing segments AND earlier rows in this same file.
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

async function evaluateAll(raw: RawFeature[]): Promise<Evaluated[]> {
  const segments = await getSegments();
  const existingIds = new Set(segments.features.map((f) => f.properties.id));
  const seenIds = new Set<string>();
  return raw.map((r, i) => evaluate(r, i, existingIds, seenIds));
}

function summarize(rows: PreviewRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    outOfBounds: rows.filter((r) => r.issues.some((i) => i.code === "bbox"))
      .length,
  };
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    action?: unknown;
    content?: unknown;
    filename?: unknown;
    verified?: unknown;
    auditor?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action;
  if (action !== "validate" && action !== "commit") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const filename = typeof body.filename === "string" ? body.filename : undefined;

  const raw = parseFile(body.content, filename);
  if (!raw || raw.length === 0) {
    return NextResponse.json({ error: "parse" }, { status: 400 });
  }
  if (raw.length > MAX_FEATURES) {
    return NextResponse.json({ error: "too_many" }, { status: 413 });
  }

  const evaluated = await evaluateAll(raw);
  const rows = evaluated.map((e) => e.row);
  const summary = summarize(rows);

  if (action === "validate") {
    return NextResponse.json({ rows, summary });
  }

  // Commit: apply the valid, non-duplicate features through the apply pipeline.
  const verified = body.verified === true;
  const auditor =
    verified && typeof body.auditor === "string" && body.auditor.trim()
      ? body.auditor.trim()
      : null;
  if (verified && !auditor) {
    return NextResponse.json({ error: "auditor_required" }, { status: 422 });
  }

  const features = evaluated
    .filter((e) => e.feature !== null)
    .map((e) => e.feature as ImportFeature);
  if (features.length === 0) {
    return NextResponse.json({ error: "no_valid" }, { status: 422 });
  }

  const result = await applyImportFeatures(features, { verified, auditor });
  return NextResponse.json({ imported: result.imported, ids: result.ids });
}
