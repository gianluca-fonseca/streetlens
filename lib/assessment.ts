/**
 * Shared segment assessment types — single Zod source of truth, no I/O.
 *
 * The map layer and capture review stack import from here instead of
 * duplicating shapes. `CvAssessment` is the map-facing alias for the same
 * stored synthesis object.
 */
export {
  segmentAssessmentSchema,
  type SegmentAssessment,
  parseSegmentAssessment,
} from "./capture/schemas";

export type { SegmentAssessment as CvAssessment } from "./capture/schemas";
