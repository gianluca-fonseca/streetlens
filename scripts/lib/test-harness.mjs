/**
 * Test harness helpers — isolated temp data stores for contract suites.
 *
 * Sets STREETLENS_DATA_DIR so local *.local.json files never touch the
 * developer's real data/ directory.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Active data dir (isolated temp or repo default). */
export function activeDataDir() {
  return process.env.STREETLENS_DATA_DIR
    ? path.resolve(process.env.STREETLENS_DATA_DIR)
    : path.join(process.cwd(), "data");
}

/** Path for a local store file inside the active data dir. */
export function localDataPath(filename) {
  return path.join(activeDataDir(), filename);
}

/**
 * Create a temp data dir and set STREETLENS_DATA_DIR.
 * Returns the temp path; pass to cleanupIsolatedDataDir when done.
 */
export function setupIsolatedDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "streetlens-test-"));
  process.env.STREETLENS_DATA_DIR = dir;
  return dir;
}

/** Remove a temp data dir created by setupIsolatedDataDir. */
export function cleanupIsolatedDataDir(dir) {
  delete process.env.STREETLENS_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
}
