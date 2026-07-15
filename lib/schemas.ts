/**
 * Zod schemas for anonymous contribution payloads.
 *
 * These validate the `payload` (and envelope) of rows inserted into the
 * `submissions` table. The contribution unit imports these to validate on the
 * client and again on the server before insert. Keep field names aligned with
 * the `submissions` migration (`0005_submissions.sql`).
 */

import { z } from "zod";

/** Costa Rica bounding box, generous, to reject obviously bogus coordinates. */
const LNG = z.number().min(-86).max(-82);
const LAT = z.number().min(8).max(11.5);

/** A single [longitude, latitude] position. */
export const positionSchema = z.tuple([LNG, LAT]);

/** A LineString path: at least two positions. */
export const lineStringCoordsSchema = z
  .array(positionSchema)
  .min(2, "A segment needs at least two points");

export const highwaySchema = z.enum([
  "residential",
  "tertiary",
  "secondary",
  "unclassified",
  "footway",
  "path",
  "living_street",
]);

/** Payload for proposing a brand-new street segment. */
export const addSegmentPayloadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  highway: highwaySchema,
  coordinates: lineStringCoordsSchema,
  note: z.string().trim().max(1000).optional(),
});
export type AddSegmentPayload = z.infer<typeof addSegmentPayloadSchema>;

/** Payload for proposing an edit to an existing segment. */
export const updateSegmentPayloadSchema = z.object({
  segment_id: z.string().trim().min(1).max(64),
  patch: z
    .object({
      name: z.string().trim().min(1).max(160).optional(),
      highway: highwaySchema.optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, {
      message: "At least one field must change",
    }),
  reason: z.string().trim().min(1).max(1000),
});
export type UpdateSegmentPayload = z.infer<typeof updateSegmentPayloadSchema>;

/**
 * Full submission envelope as posted by an anonymous contributor.
 *
 * `honeypot` must stay empty: a filled value signals a bot and is recorded as
 * `honeypot_tripped` server-side. `contact` is optional and never published.
 */
export const submissionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_segment"),
    payload: addSegmentPayloadSchema,
    contact: z.string().trim().max(200).optional(),
    honeypot: z.string().max(0).optional().default(""),
  }),
  z.object({
    type: z.literal("update_segment"),
    payload: updateSegmentPayloadSchema,
    contact: z.string().trim().max(200).optional(),
    honeypot: z.string().max(0).optional().default(""),
  }),
]);
export type Submission = z.infer<typeof submissionSchema>;

/** Parse+validate an unknown value as a submission. Throws on invalid input. */
export function parseSubmission(input: unknown): Submission {
  return submissionSchema.parse(input);
}

/* ------------------------------------------------------------------ *
 * Bulk import (u7)
 *
 * Admin bulk import accepts a GeoJSON FeatureCollection of LineStrings or a CSV.
 * Both normalize to the same per-feature shape below, validated one feature at a
 * time so the dry-run can report per-row errors without failing the whole file.
 * ------------------------------------------------------------------ */

/** A single import feature after normalization (GeoJSON or CSV row). */
export const importFeatureSchema = z.object({
  /** Optional stable id; deduped against existing segments in the dry-run. */
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(160),
  highway: highwaySchema,
  coordinates: lineStringCoordsSchema,
});
export type ImportFeature = z.infer<typeof importFeatureSchema>;

/** GeoJSON LineString geometry as it arrives in an uploaded FeatureCollection. */
export const geoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: lineStringCoordsSchema,
});

/** One raw GeoJSON Feature (LineString) prior to normalization. */
export const geoJsonFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      name: z.string().optional(),
      highway: z.string().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  geometry: geoJsonLineStringSchema,
});

/**
 * The uploaded FeatureCollection envelope. Only the envelope shape is validated
 * here; each feature is validated individually (see `importFeatureSchema`) so
 * mixed/invalid files yield per-row errors instead of a single opaque failure.
 */
export const geoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()).min(1, "The file has no features"),
});
