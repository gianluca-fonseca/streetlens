/**
 * reprocess-core.mjs — the pure logic behind scripts/reprocess-capture-session.mjs.
 *
 * Kept apart from the script so it can be unit-tested with a fixture and no
 * network: everything here is a pure function of its inputs. The script wires
 * these to the Supabase RPCs and the (compiled) HMM matcher; the matcher itself
 * is tested by scripts/test-matching-hmm.mjs and is not re-covered here.
 *
 * THE TIME PROBLEM this file solves. capture_finalize_session stores the track
 * as a bare geography LINESTRING (0013), so the per-vertex timestamps the device
 * reported do not survive. The HMM associates frames to traversals BY TIME
 * (lib/matching/hmm.ts), so a track handed to it needs a `t` on every vertex.
 * The frames DO keep their capture times, so we reconstruct vertex times from
 * them: assume constant pace and spread the frames' [min t, max t] span across
 * the track by cumulative arc length. It is an assumption, and an honest one for
 * a walk — the reconstructed times are monotonic, bracket the frame span, and
 * put a vertex at the fraction of the walk its distance implies.
 */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] or {lng,lat} points. */
export function haversine(a, b) {
  const aLng = Array.isArray(a) ? a[0] : a.lng;
  const aLat = Array.isArray(a) ? a[1] : a.lat;
  const bLng = Array.isArray(b) ? b[0] : b.lng;
  const bLat = Array.isArray(b) ? b[1] : b.lat;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Rebuild a matcher-ready track from the stored vertices and the frames.
 *
 * @param {{lng:number, lat:number}[]} trackVerts  Ordered vertices of the stored track.
 * @param {{seq:number, t:number}[]} frames        Registered frames with capture times.
 * @returns {{lng:number, lat:number, t:number}[]} Track points with reconstructed times.
 *
 * Returns [] when there is no track or no frame to anchor time to — both are
 * "nothing to re-match" cases the caller treats as a clean no-op.
 */
export function buildTrackFromSession(trackVerts, frames) {
  if (!Array.isArray(trackVerts) || trackVerts.length === 0) return [];
  if (!Array.isArray(frames) || frames.length === 0) return [];

  const times = frames.map((f) => Number(f.t)).filter((t) => Number.isFinite(t));
  if (times.length === 0) return [];
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const span = tMax - tMin;

  // Cumulative arc length along the track.
  const cum = [0];
  for (let i = 1; i < trackVerts.length; i++) {
    cum.push(cum[i - 1] + haversine(trackVerts[i - 1], trackVerts[i]));
  }
  const total = cum[cum.length - 1];

  return trackVerts.map((v, i) => {
    // Degenerate track (zero length) or a single-frame span => every vertex
    // shares the one time we have. The matcher tolerates equal timestamps
    // (scripts/test-matching-hmm.mjs proves it).
    const frac = total > 0 ? cum[i] / total : 0;
    return { lng: v.lng, lat: v.lat, t: Math.round(tMin + frac * span) };
  });
}

/**
 * Turn the matcher's per-frame attribution into the payload the reprocess RPC
 * takes: one entry per frame, unplaced frames included with a null segmentId so
 * the RPC sees the full picture (it decides which to act on).
 *
 * @param {{seq:number}[]} frames
 * @param {Map<number, {segmentId:string|null, nearJunction:boolean}>} attribution
 * @returns {{seq:number, segmentId:string|null, nearJunction:boolean}[]}
 */
export function buildAttributionPayload(frames, attribution) {
  return frames.map((f) => {
    const hit = attribution.get(f.seq);
    return {
      seq: f.seq,
      segmentId: hit?.segmentId ?? null,
      nearJunction: hit?.nearJunction ?? false,
    };
  });
}

/**
 * Human-readable summary of a match: how many frames landed, on which segments,
 * and how many are still unplaced. Pure — takes the same attribution map.
 *
 * @param {{seq:number}[]} frames
 * @param {Map<number, {segmentId:string|null, nearJunction:boolean}>} attribution
 */
export function summarizeAttribution(frames, attribution) {
  const bySegment = {};
  let attributed = 0;
  let unmatched = 0;
  for (const f of frames) {
    const segmentId = attribution.get(f.seq)?.segmentId ?? null;
    if (segmentId) {
      attributed += 1;
      bySegment[segmentId] = (bySegment[segmentId] ?? 0) + 1;
    } else {
      unmatched += 1;
    }
  }
  return { total: frames.length, attributed, unmatched, bySegment };
}

/**
 * Load the audited network from data/segments.geojson into the matcher's
 * {id, coordinates} shape. Reads the file the default matcher would (this makes
 * the segment source explicit rather than relying on process.cwd()).
 *
 * @param {(path:string)=>string} readText  A file reader (fs.readFileSync bound to utf8).
 * @param {string} geojsonPath
 * @returns {{id:string, coordinates:[number,number][]}[]}
 */
export function loadSegments(readText, geojsonPath) {
  const parsed = JSON.parse(readText(geojsonPath));
  return (parsed.features ?? [])
    .filter(
      (f) =>
        f.geometry?.type === "LineString" && typeof f.properties?.id === "string",
    )
    .map((f) => ({ id: f.properties.id, coordinates: f.geometry.coordinates }));
}
