/**
 * Shared select list for community_cv_observations rows.
 *
 * Prefer the 0028 column set; fall back when the live DB has not applied
 * migration 0028 yet so public reads stay live rather than degrading.
 */

export const CV_OBSERVATION_SELECT =
  "id,segment_id,session_id,score_overall,score_accessibility,score_drainage,score_shade,score_bike,item_medians,coverage,confidence,frame_refs,captured_on,submission_id,created_at,human_corrected,overrides,assessment,assessment_es";

export const CV_OBSERVATION_SELECT_PRE_0028 =
  "id,segment_id,session_id,score_overall,score_accessibility,score_drainage,score_shade,score_bike,item_medians,coverage,confidence,frame_refs,captured_on,submission_id,created_at,human_corrected,overrides,assessment";

/** True when PostgREST complains that assessment_es is not on the table yet. */
export function isMissingAssessmentEsColumn(message: string): boolean {
  return /assessment_es/i.test(message) && /does not exist|schema cache/i.test(message);
}
