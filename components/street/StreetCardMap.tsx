"use client";

import type { LineString } from "geojson";
import SegmentMiniMap from "@/components/street/SegmentMiniMap";

export default function StreetCardMap({
  geometry,
  overallScore,
}: Readonly<{
  geometry: LineString;
  /** Null when no audit stands behind this street; the line goes neutral. */
  overallScore: number | null;
}>) {
  return <SegmentMiniMap geometry={geometry} overallScore={overallScore} />;
}
