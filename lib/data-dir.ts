import path from "node:path";

/**
 * Directory for gitignored local runtime stores (`*.local.json`).
 *
 * Override with `STREETLENS_DATA_DIR` in tests for isolated temp stores.
 * Committed static files (`demo-segments.geojson`, etc.) stay in repo `data/`.
 */
export function getDataDir(): string {
  const override = process.env.STREETLENS_DATA_DIR;
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "data");
}
