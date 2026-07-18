/**
 * Public evidence strip — privacy-safe frame URLs for the segment detail panel.
 *
 * Policy (0028):
 *   - Never put frame_refs or session_id on the map GeoJSON wire.
 *   - Only paths that already appear on a published community_cv_observations
 *     row for THIS segment may be signed.
 *   - Signed URLs are short-lived and minted server-side.
 *   - Cap at a small strip (3) matching the old placeholder grid.
 *
 * When signing fails or no published frames exist, the panel shows a deliberate
 * empty state rather than inventing imagery or exposing raw object URLs.
 */

import {
  EVIDENCE_SIGNED_URL_TTL_SECONDS,
  isFrameSigningConfigured,
  trySignedFrameUrl,
} from "./capture/storage";

/** Max tiles in the public evidence strip. */
export const EVIDENCE_STRIP_MAX = 3;

const FRAME_PATH_RE =
  /^captures\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/frame-[0-9]{4}\.jpg$/i;

export type EvidenceFrame = {
  /** Opaque index for the strip (not a storage seq). */
  i: number;
  /** Time-limited signed URL — never a raw public object path. */
  url: string;
};

export type SegmentEvidence = {
  frames: EvidenceFrame[];
  /** Why the strip is empty when frames.length === 0. */
  emptyReason: "none" | "unavailable" | null;
};

/**
 * Collect up to {@link EVIDENCE_STRIP_MAX} published frame paths for a segment.
 * Paths are validated against the storage convention before signing.
 */
export function selectEvidencePaths(
  frameRefsLists: readonly (readonly string[])[],
  max = EVIDENCE_STRIP_MAX,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of frameRefsLists) {
    for (const path of list) {
      if (typeof path !== "string" || !FRAME_PATH_RE.test(path)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Build signed evidence URLs for one segment id. */
export async function getSegmentEvidence(segmentId: string): Promise<SegmentEvidence> {
  const raw = await loadRawFrameRefs(segmentId);
  if (raw.length === 0) {
    return { frames: [], emptyReason: "none" };
  }

  const paths = selectEvidencePaths(raw);
  if (paths.length === 0) {
    return { frames: [], emptyReason: "none" };
  }

  const privileged = isFrameSigningConfigured();
  const frames: EvidenceFrame[] = [];
  for (let i = 0; i < paths.length; i++) {
    const url = await trySignedFrameUrl(paths[i], {
      expiresIn: EVIDENCE_SIGNED_URL_TTL_SECONDS,
      // Published paths are SELECT-allowed for anon; prefer service role when
      // present so one signing path covers admin + public.
      privileged,
    });
    if (url) frames.push({ i, url });
  }

  if (frames.length === 0) {
    // Paths exist but signing failed (private bucket, no key, storage miss).
    // Safest visible alternative: empty strip, not raw URLs.
    return { frames: [], emptyReason: "unavailable" };
  }

  return { frames, emptyReason: null };
}

/** Server-only: load frame_refs for a segment without putting them on the wire. */
async function loadRawFrameRefs(segmentId: string): Promise<string[][]> {
  const { readCvObservations } = await import("./community-store");
  const { getSupabaseClient } = await import("./supabase");
  const { fetchAllPages } = await import("./supabase-bounded");

  const client = getSupabaseClient();
  if (client) {
    try {
      type Row = { frame_refs: string[] | null };
      const rows = await fetchAllPages<Row>(
        `evidence frame_refs segment=${segmentId}`,
        async (from, to) => {
          const { data, error } = await client
            .from("community_cv_observations")
            .select("frame_refs,created_at")
            .eq("segment_id", segmentId)
            .order("created_at", { ascending: false })
            .range(from, to);
          if (error) throw error;
          return data ?? [];
        },
      );
      return rows
        .map((r) => (Array.isArray(r.frame_refs) ? r.frame_refs : []))
        .filter((list) => list.length > 0);
    } catch {
      // fall through to local store
    }
  }

  const local = await readCvObservations();
  return local
    .filter((o) => o.segment_id === segmentId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((o) => (Array.isArray(o.frame_refs) ? o.frame_refs : []))
    .filter((list) => list.length > 0);
}
