import { canonicalCvObservation } from "@/lib/cv-provenance";
import type { SegmentCollection, StreetStats } from "@/lib/segments";

/**
 * True when the public site is in the real-data era with no published field
 * audits yet. Audited headline figures read 0 in this state; the UI must not
 * treat them as the hero readout.
 *
 * Takes the effective demo-data flag rather than reading it: this helper runs
 * inside client components, which get the resolved value from
 * `DemoDataProvider` (a client-side env read would miss the cookie override).
 */
export function hideAuditedZeros(
  stats: StreetStats,
  demoEnabled: boolean,
): boolean {
  return !demoEnabled && stats.segments === 0;
}

export type CvObservedStreet = {
  id: string;
  name: string;
  district: string;
};

/** Recently camera-observed streets for the landing list, newest walk first. */
export function listRecentlyCvObserved(
  segments: SegmentCollection,
  limit = 10,
): CvObservedStreet[] {
  return segments.features
    .filter((f) => (f.properties.cv_count ?? 0) > 0)
    .map((f) => {
      const canonical = canonicalCvObservation(f.properties.cv_observations);
      return {
        id: f.properties.id,
        name: f.properties.name,
        district: f.properties.district,
        walked: canonical?.captured_on ?? "",
      };
    })
    .sort((a, b) => b.walked.localeCompare(a.walked))
    .slice(0, limit)
    .map(({ id, name, district }) => ({ id, name, district }));
}
