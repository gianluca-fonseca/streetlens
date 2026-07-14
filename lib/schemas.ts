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
