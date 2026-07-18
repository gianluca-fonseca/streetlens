/**
 * Public segment brief — name, district, bbox only. No scores, audits, or PII.
 */

import type { LineString } from "geojson";
import { getSegmentDetail } from "@/lib/segments";

export type SegmentBrief = Readonly<{
  id: string;
  name: string;
  district: string;
  bbox: readonly [number, number, number, number];
}>;

function bboxFromLine(geometry: LineString): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of geometry.coordinates) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(west)) return [0, 0, 0, 0];
  return [west, south, east, north];
}

/** Bounded public lookup for QR deep links and status rollups. */
export async function getSegmentBrief(id: string): Promise<SegmentBrief | null> {
  if (!id || id.length > 64) return null;
  const detail = await getSegmentDetail(id);
  if (!detail) return null;
  return {
    id: detail.id,
    name: detail.name,
    district: detail.district,
    bbox: bboxFromLine(detail.geometry),
  };
}
