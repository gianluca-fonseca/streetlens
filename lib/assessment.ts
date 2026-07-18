/**
 * Shared segment assessment types — single Zod source of truth, no I/O.
 *
 * The map layer and capture review stack import from here instead of
 * duplicating shapes. `CvAssessment` is the map-facing alias for the same
 * stored synthesis object.
 */
export {
  segmentAssessmentSchema,
  segmentAssessmentEsSchema,
  assessmentOverallForLocale,
  type SegmentAssessment,
  type SegmentAssessmentEs,
  parseSegmentAssessment,
  parseSegmentAssessmentEs,
} from "./capture/schemas";

export type { SegmentAssessment as CvAssessment } from "./capture/schemas";
export type { SegmentAssessmentEs as CvAssessmentEs } from "./capture/schemas";
