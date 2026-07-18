"use client";

import type { LineString } from "geojson";
import SegmentMiniMap from "@/components/street/SegmentMiniMap";

export default function StreetCardMap({
  geometry,
  overallScore,
}: Readonly<{
  geometry: LineString;
  overallScore: number;
}>) {
  return <SegmentMiniMap geometry={geometry} overallScore={overallScore} />;
}
