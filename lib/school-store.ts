/**
 * Everything an admin can change about a school, persisted.
 *
 * The roster (data/schools.geojson) and the zones (data/school-zones.json) are
 * GENERATED and read-only — regenerating them must never destroy an editor's
 * work. So every human edit lives here instead, as a sparse overlay keyed by
 * school id, and the read path in lib/school-report.ts layers it on top. A
 * roster rebuild that renames a school leaves its photo, its notes, and its
 * override exactly where they were.
 *
 * Three separate overlays rather than one blob, because they have different
 * authorities and different lifetimes:
 *
 *   profile     descriptive. Photo, contact, enrolment, notes, and corrections
 *               to the register's own fields. Never affects a score.
 *   override    a human overruling the computed tier or score, with a reason.
 *               Loud by construction: an overridden number is labelled as one
 *               everywhere it appears, and the computed value is kept beside it.
 *   assessment  the written reading of the zone — model-generated, editable,
 *               and stamped with which it is.
 *
 * Dependency-light on purpose (fs + path + types, no zod): the public map reads
 * through here, and the validation stack belongs on the write path, which is the
 * admin API. Mirrors lib/community-store.ts, including the gitignored
 * `*.local.json` convention, so when Supabase is provisioned this module is the
 * one seam that changes.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getDataDir } from "./data-dir";
import type { SchoolTier } from "./school-score";

export const SCHOOL_PROFILES_PATH = path.join(getDataDir(), "school-profiles.local.json");
export const SCHOOL_OVERRIDES_PATH = path.join(getDataDir(), "school-overrides.local.json");
export const SCHOOL_ASSESSMENTS_PATH = path.join(getDataDir(), "school-assessments.local.json");
/** Uploaded photos live beside the stores, not in the repo. */
export const SCHOOL_MEDIA_DIR = path.join(getDataDir(), "school-media");

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Editable, entirely optional description. Blank fields fall through to the
 *  MEP register, which is why every one of these is nullable rather than "". */
export type SchoolProfile = {
  school_id: string;
  /** Overrides the register's name on public surfaces when set. */
  display_name?: string | null;
  address?: string | null;
  /** The register carries no enrolment; this is the only place it can come
   *  from, and it is what upgrades the priority ranking off its proxy. */
  enrollment?: number | null;
  level?: string | null;
  principal?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** Free notes — access constraints, the gate that actually gets used, who to
   *  call before turning up with a camera. */
  notes?: string | null;
  /** Uploaded photo, stored under SCHOOL_MEDIA_DIR and served by the API. */
  photo?: { filename: string; mime: string; size: number; uploaded_at: string } | null;
  updated_at: string;
};

/** A human overruling the computed reading. Never silent. */
export type SchoolOverride = {
  school_id: string;
  /** Publish this tier instead of the computed one. */
  tier?: SchoolTier | null;
  /** Publish this 0–100 instead of the computed one. */
  score?: number | null;
  /** Required. An override without a stated reason is indistinguishable from
   *  a mistake, and this number ends up in a partner's deck. */
  reason: string;
  author: string;
  created_at: string;
};

/** The written reading of a zone. */
export type SchoolAssessment = {
  school_id: string;
  /** One-paragraph summary of what the walk to this school is like. */
  overall: string;
  /** Spanish companion; public surfaces prefer it when the locale is `es`. */
  overall_es?: string | null;
  /** Named findings, each pointing at a segment where possible. */
  findings?: { text: string; segment_id?: string | null }[];
  /** `model` when written by the synthesis pass, `human` once edited. An edited
   *  assessment stops claiming to be model output the moment a person touches
   *  it — the provenance label is the whole value of the field. */
  origin: "model" | "human";
  model?: string | null;
  /** The score snapshot the text was written against, so a stale assessment is
   *  detectable rather than quietly describing last month's streets. */
  scored_at?: string | null;
  coverage_at_write?: number | null;
  author?: string | null;
  updated_at: string;
};

/* ------------------------------------------------------------------ *
 * File helpers (same contract as community-store: never throw on read)
 * ------------------------------------------------------------------ */

async function readRows<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeRows(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function upsert<T extends { school_id: string }>(existing: T[], row: T): T[] {
  const out = existing.filter((r) => r.school_id !== row.school_id);
  out.push(row);
  return out;
}

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

export async function readSchoolProfiles(): Promise<SchoolProfile[]> {
  return readRows<SchoolProfile>(SCHOOL_PROFILES_PATH);
}

export async function readSchoolProfileMap(): Promise<Map<string, SchoolProfile>> {
  return new Map((await readSchoolProfiles()).map((p) => [p.school_id, p]));
}

/**
 * Merge a partial edit into a school's profile.
 *
 * Merge rather than replace so a form that only carries the notes field cannot
 * silently wipe an uploaded photo. `null` is an explicit clear; `undefined`
 * means "not part of this edit", which is the distinction a PATCH needs and the
 * reason these fields are `T | null` rather than optional-only.
 */
export async function saveSchoolProfile(
  schoolId: string,
  patch: Partial<Omit<SchoolProfile, "school_id" | "updated_at">>,
  now: string = new Date().toISOString(),
): Promise<SchoolProfile> {
  const rows = await readSchoolProfiles();
  const current = rows.find((r) => r.school_id === schoolId);
  const next: SchoolProfile = {
    ...(current ?? { school_id: schoolId, updated_at: now }),
    ...patch,
    school_id: schoolId,
    updated_at: now,
  };
  await writeRows(SCHOOL_PROFILES_PATH, upsert(rows, next));
  return next;
}

/* ------------------------------------------------------------------ *
 * Overrides
 * ------------------------------------------------------------------ */

export async function readSchoolOverrides(): Promise<SchoolOverride[]> {
  return readRows<SchoolOverride>(SCHOOL_OVERRIDES_PATH);
}

export async function readSchoolOverrideMap(): Promise<Map<string, SchoolOverride>> {
  return new Map((await readSchoolOverrides()).map((o) => [o.school_id, o]));
}

export async function saveSchoolOverride(row: SchoolOverride): Promise<void> {
  await writeRows(SCHOOL_OVERRIDES_PATH, upsert(await readSchoolOverrides(), row));
}

/** Drop an override so the school returns to its computed reading. */
export async function clearSchoolOverride(schoolId: string): Promise<void> {
  const rows = await readSchoolOverrides();
  await writeRows(
    SCHOOL_OVERRIDES_PATH,
    rows.filter((r) => r.school_id !== schoolId),
  );
}

/* ------------------------------------------------------------------ *
 * Assessments
 * ------------------------------------------------------------------ */

export async function readSchoolAssessments(): Promise<SchoolAssessment[]> {
  return readRows<SchoolAssessment>(SCHOOL_ASSESSMENTS_PATH);
}

export async function readSchoolAssessmentMap(): Promise<Map<string, SchoolAssessment>> {
  return new Map((await readSchoolAssessments()).map((a) => [a.school_id, a]));
}

export async function saveSchoolAssessment(row: SchoolAssessment): Promise<void> {
  await writeRows(SCHOOL_ASSESSMENTS_PATH, upsert(await readSchoolAssessments(), row));
}

/* ------------------------------------------------------------------ *
 * Photos
 * ------------------------------------------------------------------ */

/** Extensions accepted for a school photo, mapped from their MIME type. */
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 6 MB. A school photo is context on a card, not an archival asset. */
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/**
 * Store a photo for a school, replacing any previous one.
 *
 * The filename is derived from the school id and the MIME type, never from the
 * upload's own name: an attacker-supplied filename is how a write escapes the
 * directory it was meant for, and nothing downstream needs the original name.
 */
export async function saveSchoolPhoto(
  schoolId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ filename: string; mime: string; size: number; uploaded_at: string }> {
  const ext = PHOTO_TYPES[mime];
  if (!ext) throw new Error(`unsupported_type:${mime}`);
  if (bytes.byteLength > PHOTO_MAX_BYTES) throw new Error("too_large");

  const safeId = schoolId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) throw new Error("bad_school_id");
  const filename = `${safeId}.${ext}`;

  await fs.mkdir(SCHOOL_MEDIA_DIR, { recursive: true });
  // Drop the other extensions for this school so a jpg→png swap cannot leave
  // two files where the profile points at one.
  for (const other of Object.values(PHOTO_TYPES)) {
    if (other === ext) continue;
    await fs.rm(path.join(SCHOOL_MEDIA_DIR, `${safeId}.${other}`), { force: true });
  }
  await fs.writeFile(path.join(SCHOOL_MEDIA_DIR, filename), bytes);

  return { filename, mime, size: bytes.byteLength, uploaded_at: new Date().toISOString() };
}

/** Read a stored photo back, or null when it is gone. */
export async function readSchoolPhoto(
  filename: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  // Reject anything that is not exactly the shape saveSchoolPhoto emits, so a
  // crafted profile row cannot turn this into an arbitrary file read.
  if (!/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filename)) return null;
  const ext = filename.split(".").pop()!;
  const mime = Object.entries(PHOTO_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  try {
    return { bytes: await fs.readFile(path.join(SCHOOL_MEDIA_DIR, filename)), mime };
  } catch {
    return null;
  }
}

/** Remove a school's photo and forget it in the profile. */
export async function deleteSchoolPhoto(schoolId: string): Promise<void> {
  const safeId = schoolId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return;
  for (const ext of Object.values(PHOTO_TYPES)) {
    await fs.rm(path.join(SCHOOL_MEDIA_DIR, `${safeId}.${ext}`), { force: true });
  }
  await saveSchoolProfile(schoolId, { photo: null });
}
