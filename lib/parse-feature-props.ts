/**
 * parse-feature-props — normalize the raw `properties` read off a clicked
 * maplibre-gl feature into a well-formed SegmentProperties.
 *
 * WHY THIS EXISTS: maplibre-gl serializes non-primitive GeoJSON feature
 * properties to JSON STRINGS at the source/worker boundary. So a segment's
 * `community_report` arrives on `feature.properties` as a JSON string (or the
 * literal `"null"`), and `community_reports` arrives as `"[]"` or a JSON-array
 * string — never as an object/array. Consumed unparsed, SegmentDetail spreads a
 * string into individual characters and calls `.slice` on a non-report value,
 * which throws and takes the whole public map down via the app error boundary.
 *
 * These helpers JSON.parse those fields when they arrive as strings, tolerate
 * object/array passthrough (DB / SSR path already delivers real objects), and
 * NEVER throw: malformed JSON, `"null"`, or unexpected shapes collapse to safe
 * defaults (a null report, an empty reports array).
 *
 * u30 adds `cv_observations` to the same treatment. Every non-primitive property
 * on SegmentProperties crosses this boundary and needs a coercer here; adding one
 * without it reintroduces the exact crash described above.
 */

import type {
  CommunityReport,
  CvObservation,
  SegmentProperties,
} from "./types";

/** A value counts as a report only if it is a plain object carrying a string id. */
function asReport(value: unknown): CommunityReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof (value as { id?: unknown }).id !== "string") return null;
  return value as CommunityReport;
}

/**
 * A value counts as a CV observation only if it is a plain object with a string
 * id and a `scores` object.
 *
 * `scores` is checked because it is what the CV panel indexes into; an object
 * with an id but no scores would sail past an id-only guard and then throw on
 * first render, which is the class of bug this module exists to prevent.
 */
function asCvObservation(value: unknown): CvObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { id?: unknown; scores?: unknown };
  if (typeof v.id !== "string") return null;
  if (!v.scores || typeof v.scores !== "object" || Array.isArray(v.scores)) {
    return null;
  }
  return value as CvObservation;
}

/**
 * Coerce a single embedded community report. Accepts an object (passthrough), a
 * JSON string (parsed), or null/`"null"`/malformed (→ null). Never throws.
 */
export function parseCommunityReport(raw: unknown): CommunityReport | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "null") return null;
    try {
      return asReport(JSON.parse(s));
    } catch {
      return null;
    }
  }
  return asReport(raw);
}

/**
 * Coerce a list of attached community reports. Accepts an array (passthrough), a
 * JSON-array string like `"[]"` (parsed), or anything else (→ empty array).
 * Drops any element that is not a valid report. Never throws.
 */
export function parseCommunityReports(raw: unknown): CommunityReport[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(asReport)
    .filter((r): r is CommunityReport => r !== null);
}

/**
 * Coerce a list of approved CV observations. Same contract as
 * `parseCommunityReports`: array passthrough, JSON-array string parsed, anything
 * else → empty. Drops invalid elements. Never throws.
 */
export function parseCvObservations(raw: unknown): CvObservation[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(asCvObservation)
    .filter((o): o is CvObservation => o !== null);
}

/**
 * Normalize a clicked feature's raw properties into SegmentProperties with the
 * non-primitive fields safely parsed. Primitive fields (id, name, scores, …) pass
 * through untouched — maplibre keeps primitives as primitives.
 */
export function parseFeatureProps(
  raw: Record<string, unknown> | null | undefined,
): SegmentProperties {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(p as unknown as SegmentProperties),
    community_report: parseCommunityReport(p.community_report),
    community_reports: parseCommunityReports(p.community_reports),
    cv_observations: parseCvObservations(p.cv_observations),
  };
}
