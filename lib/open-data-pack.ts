/**
 * Shared loader for open-data API routes: paint segments + lengths + CV map.
 *
 * Both loaders take the effective demo-data flag so the published export never
 * disagrees with the site the caller is looking at: with the demo era off, the
 * generated pilot scores are stripped here exactly as they are on the map.
 */

import {
  buildOpenDataCsv,
  buildOpenDataGeoJson,
} from "./open-data";
import {
  getNetworkLengthsById,
  getSegments,
  listApprovedCvObservations,
} from "./segments";
import type { CvObservation } from "./types";

function groupCvBySegment(
  observations: CvObservation[],
): Map<string, CvObservation[]> {
  const byId = new Map<string, CvObservation[]>();
  for (const o of observations) {
    const list = byId.get(o.segment_id);
    if (list) list.push(o);
    else byId.set(o.segment_id, [o]);
  }
  return byId;
}

export async function loadOpenDataGeoJson(demoEnabled: boolean) {
  const [segments, lengths, cv] = await Promise.all([
    getSegments(demoEnabled),
    getNetworkLengthsById(),
    listApprovedCvObservations(),
  ]);
  return buildOpenDataGeoJson(segments, lengths, groupCvBySegment(cv));
}

export async function loadOpenDataCsv(demoEnabled: boolean): Promise<string> {
  const [segments, lengths, cv] = await Promise.all([
    getSegments(demoEnabled),
    getNetworkLengthsById(),
    listApprovedCvObservations(),
  ]);
  return buildOpenDataCsv(segments, lengths, groupCvBySegment(cv));
}
