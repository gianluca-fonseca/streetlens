/**
 * Actionable error messages for capture review API responses.
 *
 * Maps HTTP status + JSON `error` codes to reviewer-facing copy keys so the
 * workbench can say what happened and what to do next.
 */

export type CaptureReviewErrorKey =
  | "errorUnauthorized"
  | "errorNotReviewable"
  | "errorDroppedSegments"
  | "errorUnknownSegments"
  | "errorBadRequest"
  | "errorNotFound"
  | "errorGeneric";

export type FrameDeleteErrorKey =
  | "deleteErrorUnauthorized"
  | "deleteErrorBadRequest"
  | "deleteError"
  | "errorGeneric";

export async function captureReviewErrorKey(res: Response): Promise<CaptureReviewErrorKey> {
  if (res.status === 401) return "errorUnauthorized";
  if (res.status === 404) return "errorNotFound";
  if (res.status === 400) return "errorBadRequest";
  if (res.status === 409) return "errorNotReviewable";
  if (res.status === 422) {
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error === "dropped_segments") return "errorDroppedSegments";
      if (body.error === "unknown_segments") return "errorUnknownSegments";
    } catch {
      // fall through
    }
    return "errorBadRequest";
  }
  return "errorGeneric";
}

export function frameDeleteErrorKey(res: Response): FrameDeleteErrorKey {
  if (res.status === 401) return "deleteErrorUnauthorized";
  if (res.status === 400) return "deleteErrorBadRequest";
  if (!res.ok) return "deleteError";
  return "errorGeneric";
}

/** Reason preset keys — filled into the textarea and remain editable. */
export const REASON_PRESET_KEYS = [
  "reasonPresetLooksGood",
  "reasonPresetExcludedBlurry",
  "reasonPresetCorrectedRamps",
  "reasonPresetOverbudgetPartial",
] as const;

export type ReasonPresetKey = (typeof REASON_PRESET_KEYS)[number];
