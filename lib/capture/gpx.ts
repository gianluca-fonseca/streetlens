/**
 * GPX import: pulling a route out of a file someone already has.
 *
 * A contributor who rode a corridor with a bike computer, or drew a line in a
 * planning tool, has a GPX. Asking them to re-walk it with our recorder to get
 * the same geometry would be absurd, so this reads the one element that matters
 * (`<trkpt>`) and hands back plain points. Everything downstream (sorting,
 * accuracy filtering, usability) is `validateTrack`'s job, not this file's.
 *
 * This does NOT use DOMParser, and that is deliberate rather than an oversight.
 * The parse has to run in three places: the browser, a server route, and a bare
 * node test harness with no DOM shim. Pulling in a full XML parser to satisfy
 * the third would add a dependency to a hot import path for a structure we can
 * describe in a sentence: trkpt elements with lat/lon attributes and at most two
 * child elements we care about. So this is a narrow scanner over that structure,
 * not an XML parser, and the honest tradeoff is that it will mis-read genuinely
 * exotic XML: comments or CDATA containing a literal `<trkpt`, an attribute
 * value containing `>`, entity-encoded numbers. Real GPX from real devices does
 * none of those. If a file ever shows up that does, the fix is a real parser,
 * not a cleverer regex.
 *
 * Pure: no I/O, no clock, no DOM.
 */

/** One point as the file described it. `lng` (not `lon`) to match TrackPoint. */
export type GpxPoint = {
  lat: number;
  lng: number;
  /** Metres above the ellipsoid, when the file carries `<ele>`. */
  ele?: number;
  /** Epoch ms, UTC, parsed from `<time>`. Absent when the file is untimed. */
  t?: number;
};

/**
 * `reason` is machine-ish snake_case, not a sentence: the API layer maps it to
 * copy, and a caller should be able to branch on it.
 */
export type GpxParseResult =
  | { ok: true; points: GpxPoint[]; hasTimes: boolean }
  | { ok: false; reason: string };

/** `<trkpt ...>` or `<trkpt .../>`. The attribute chunk is captured whole. */
const TRKPT_OPEN = /<trkpt\b([^>]*)>/g;
const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ELE = /<ele\b[^>]*>([^<]*)<\/ele>/i;
const TIME = /<time\b[^>]*>([^<]*)<\/time>/i;

/** Attributes off one `<trkpt` open tag, lowercased keys, quote style either way. */
function readAttributes(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m = ATTR.exec(chunk);
  while (m !== null) {
    out[m[1]!.toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] ?? "");
    m = ATTR.exec(chunk);
  }
  return out;
}

/**
 * Read a route out of GPX text.
 *
 * Points come back in document order and are NOT sorted. GPX writes a track in
 * the order it was travelled, so document order IS the route; sorting by time
 * here would silently reorder an untimed file's geometry into nonsense.
 * `validateTrack` sorts once, at the point where time is known to mean
 * something.
 *
 * A malformed point rejects the whole file rather than being skipped. Skipping
 * looks friendlier and is worse: a dropped vertex does not announce itself, it
 * just cuts a corner, and the contributor gets a route through a building with
 * no indication anything went wrong. A file with a broken coordinate is broken,
 * and saying so is the kinder failure.
 *
 * `hasTimes` is all-or-nothing. A file where some points carry `<time>` and some
 * do not cannot be treated as timed (the gaps would interpolate across an
 * unknown duration), so it is treated as untimed and the partial timestamps are
 * dropped from the points entirely. Half-trusting them is the one outcome with
 * no safe reading, so the shape makes it unrepresentable: `hasTimes === false`
 * means no point has `t`.
 */
export function parseGpx(xml: string): GpxParseResult {
  if (typeof xml !== "string" || xml.trim() === "") return { ok: false, reason: "not_gpx" };
  if (!/<gpx\b/i.test(xml)) return { ok: false, reason: "not_gpx" };

  const points: GpxPoint[] = [];
  let allTimed = true;

  TRKPT_OPEN.lastIndex = 0;
  let open = TRKPT_OPEN.exec(xml);
  while (open !== null) {
    const attrChunk = open[1]!;
    const selfClosing = attrChunk.trimEnd().endsWith("/");
    const attrs = readAttributes(attrChunk);

    const lat = Number(attrs.lat);
    const lng = Number(attrs.lon);
    if (
      attrs.lat === undefined ||
      attrs.lon === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return { ok: false, reason: "malformed_coordinates" };
    }

    const point: GpxPoint = { lat, lng };

    if (!selfClosing) {
      const bodyStart = TRKPT_OPEN.lastIndex;
      const closeAt = xml.indexOf("</trkpt>", bodyStart);
      // An unterminated trkpt means the file was truncated mid-write. The
      // geometry after it is unknowable, so this is a file-level failure.
      if (closeAt === -1) return { ok: false, reason: "unterminated_trackpoint" };
      const body = xml.slice(bodyStart, closeAt);

      const ele = ELE.exec(body);
      if (ele) {
        const v = Number(ele[1]!.trim());
        if (Number.isFinite(v)) point.ele = v;
      }

      const time = TIME.exec(body);
      // Date.parse handles the ISO-8601 GPX mandates. An unparseable stamp makes
      // the point untimed rather than invalid: the geometry is still good, and
      // the route can be timed by hand from the video instead.
      const t = time ? Date.parse(time[1]!.trim()) : Number.NaN;
      if (Number.isFinite(t)) point.t = t;
      else allTimed = false;

      TRKPT_OPEN.lastIndex = closeAt + "</trkpt>".length;
    } else {
      allTimed = false;
    }

    points.push(point);
    open = TRKPT_OPEN.exec(xml);
  }

  if (points.length === 0) return { ok: false, reason: "no_trackpoints" };

  if (!allTimed) {
    for (const p of points) delete p.t;
  }

  return { ok: true, points, hasTimes: allTimed };
}
