/**
 * Pending capture walk queue — server-side list loader.
 */

import { getPendingSubmissions } from "@/lib/submissions";
import type { CvCapturePayload } from "@/lib/schemas";

export { captureQueuePosition, nextPendingSessionId } from "./queue-position";

/** Session ids for every pending camera walk, in queue order (oldest first). */
export async function getPendingCaptureSessionIds(): Promise<string[]> {
  const { items } = await getPendingSubmissions();
  return items
    .filter((i) => i.type === "cv_capture")
    .map((i) => (i.payload as CvCapturePayload).session_id);
}
