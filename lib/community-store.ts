/**
 * Local persistence for applied community data (advisor ruling 3, local mode).
 *
 * Deliberately dependency-light: fs + path + types only, NO zod. The adapter
 * read path (lib/segments.ts) imports the readers here, so the map's data layer
 * never transitively pulls the validation stack. The apply pipeline
 * (lib/apply-submissions.ts) owns validation and calls the writers here.
 *
 * Both files are gitignored (runtime data). Writers upsert by `id`, so applying
 * the same submission or import twice never duplicates.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getDataDir } from "./data-dir";
import type { CommunityReport, CommunitySegment, CvObservation } from "./types";

export const COMMUNITY_SEGMENTS_PATH = path.join(
  getDataDir(),
  "community-segments.local.json",
);
export const COMMUNITY_REPORTS_PATH = path.join(
  getDataDir(),
  "community-reports.local.json",
);
export const COMMUNITY_CV_OBSERVATIONS_PATH = path.join(
  getDataDir(),
  "community-cv-observations.local.json",
);

async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Upsert rows into a store by `id`, preserving order (new ids appended). */
function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()];
}

/** All applied community segments (local store). Missing file → empty. */
export async function readCommunitySegments(): Promise<CommunitySegment[]> {
  return readJsonArray<CommunitySegment>(COMMUNITY_SEGMENTS_PATH);
}

/** All applied community reports (local store). Missing file → empty. */
export async function readCommunityReports(): Promise<CommunityReport[]> {
  return readJsonArray<CommunityReport>(COMMUNITY_REPORTS_PATH);
}

/** Upsert community segments into the local store. */
export async function appendCommunitySegments(
  rows: CommunitySegment[],
): Promise<void> {
  if (rows.length === 0) return;
  const merged = upsertById(await readCommunitySegments(), rows);
  await writeJson(COMMUNITY_SEGMENTS_PATH, merged);
}

/** Upsert community reports into the local store. */
export async function appendCommunityReports(
  rows: CommunityReport[],
): Promise<void> {
  if (rows.length === 0) return;
  const merged = upsertById(await readCommunityReports(), rows);
  await writeJson(COMMUNITY_REPORTS_PATH, merged);
}

/** All approved CV observations (local store). Missing file → empty. */
export async function readCvObservations(): Promise<CvObservation[]> {
  return readJsonArray<CvObservation>(COMMUNITY_CV_OBSERVATIONS_PATH);
}

/**
 * Upsert CV observations into the local store.
 *
 * Ids are `cv-<session>-<segment>`, so an admin who approves a session, changes
 * their mind about which segments, and approves again lands on the same rows
 * rather than a second set.
 */
export async function appendCvObservations(
  rows: CvObservation[],
): Promise<void> {
  if (rows.length === 0) return;
  const merged = upsertById(await readCvObservations(), rows);
  await writeJson(COMMUNITY_CV_OBSERVATIONS_PATH, merged);
}

/**
 * Drop CV observations for a session that are no longer approved.
 *
 * Needed because approval is per-SEGMENT and re-reviewable: upserting the newly
 * approved set alone would leave a previously-approved segment on the map after
 * an admin has just unticked it. Rows for other sessions are untouched.
 */
export async function pruneCvObservations(
  sessionId: string,
  keepIds: readonly string[],
): Promise<void> {
  const existing = await readCvObservations();
  const keep = new Set(keepIds);
  const next = existing.filter(
    (row) => row.session_id !== sessionId || keep.has(row.id),
  );
  if (next.length === existing.length) return;
  await writeJson(COMMUNITY_CV_OBSERVATIONS_PATH, next);
}
