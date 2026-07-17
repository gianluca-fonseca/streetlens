#!/usr/bin/env node
/**
 * test-capture-route.mjs (u28 video route intake)
 *
 * Pins the two pure modules that turn "a file plus a video" into a track: the
 * GPX scanner and the vertex-timestamping maths. Both are invisible at runtime
 * (a wrong answer here shows up three units later as a frame on the wrong
 * street), so this is where they get held still.
 *
 * The GPX side matters because the parser is a deliberate narrow scanner rather
 * than a real XML parser, so the shapes it must survive (self-closing, attribute
 * order, quote style, partial timestamps) are the contract. The route side
 * matters because the whole design rests on the inversion: time-stamp the
 * vertices, let interpolateAt place the frames. This drives that round trip end
 * to end and asserts nothing comes out NaN.
 *
 * Compiles lib/capture/*.ts to CJS (strict) and drives them directly, same
 * pattern as test-capture-gating.mjs, including the `@/` resolver patch (tsc
 * emits the alias verbatim and expects a bundler; there is none here).
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import Module from "node:module";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-capture-route");
const TSCONFIG = path.join(ROOT, ".test-tsconfig-capture-route.json");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Deep NaN sweep: every number reachable from a value must be finite. */
function hasNonFinite(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFinite);
  if (value && typeof value === "object") return Object.values(value).some(hasNonFinite);
  return false;
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });

  writeFileSync(
    TSCONFIG,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        lib: ["es2019"],
        types: [],
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
        rootDir: ".",
        outDir: path.relative(ROOT, BUILD_DIR),
      },
      files: ["lib/capture/gpx.ts", "lib/capture/route.ts", "lib/capture/track.ts"],
    }),
  );

  execFileSync("npx", ["tsc", "--project", TSCONFIG], { cwd: ROOT, stdio: "inherit" });

  // tsconfig `paths` resolves types only; tsc emits the `@/...` specifier into
  // the JS verbatim and expects a bundler to finish the job. There is no bundler
  // here, so the alias is taught to the CJS resolver instead. Scoped to this
  // process, which exits at the end of main().
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    const target = request.startsWith("@/") ? path.join(BUILD_DIR, request.slice(2)) : request;
    return resolveFilename.call(this, target, ...rest);
  };

  const base = path.join(BUILD_DIR, "lib/capture");
  const GPX = require(path.join(base, "gpx.js"));
  const R = require(path.join(base, "route.js"));
  const T = require(path.join(base, "track.js"));

  /* ---------------- GPX: the timed happy path ---------------- */

  const timedGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Escazu</name><trkseg>
    <trkpt lat="9.9187" lon="-84.1408"><ele>1120.5</ele><time>2026-07-16T14:00:00Z</time></trkpt>
    <trkpt lat="9.91879" lon="-84.1408"><ele>1121.0</ele><time>2026-07-16T14:00:10Z</time></trkpt>
    <trkpt lat="9.91888" lon="-84.1408"><ele>1122.0</ele><time>2026-07-16T14:00:20Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

  const timed = GPX.parseGpx(timedGpx);
  check("a timed GPX parses", timed.ok === true, timed.ok ? "" : timed.reason);
  check("a timed GPX yields every trackpoint", timed.ok && timed.points.length === 3);
  check("a fully timed GPX reports hasTimes", timed.ok && timed.hasTimes === true);
  check(
    "lat and lon map onto lat/lng",
    timed.ok && timed.points[0].lat === 9.9187 && timed.points[0].lng === -84.1408,
  );
  check("ele is parsed when present", timed.ok && timed.points[0].ele === 1120.5);
  check(
    "time is parsed to epoch ms UTC",
    timed.ok && timed.points[0].t === Date.parse("2026-07-16T14:00:00Z"),
    timed.ok ? String(timed.points[0].t) : "",
  );
  check(
    "points come out in document order, unsorted",
    timed.ok &&
      timed.points[0].t < timed.points[1].t &&
      timed.points[1].t < timed.points[2].t &&
      timed.points[2].lat === 9.91888,
  );
  check("a timed GPX carries no non-finite numbers", timed.ok && !hasNonFinite(timed.points));

  /* ---------------- GPX: shapes the scanner must survive ---------------- */

  const untimed = GPX.parseGpx(
    `<gpx><trk><trkseg>
      <trkpt lat="9.9187" lon="-84.1408"><ele>1120</ele></trkpt>
      <trkpt lat="9.91888" lon="-84.1408"><ele>1122</ele></trkpt>
    </trkseg></trk></gpx>`,
  );
  check("an untimed GPX still parses", untimed.ok === true, untimed.ok ? "" : untimed.reason);
  check("an untimed GPX reports hasTimes false", untimed.ok && untimed.hasTimes === false);
  check("an untimed GPX keeps its geometry", untimed.ok && untimed.points.length === 2);

  const selfClosing = GPX.parseGpx(
    `<gpx><trkseg><trkpt lat="9.9187" lon="-84.1408"/><trkpt lat="9.9188" lon="-84.1409" /></trkseg></gpx>`,
  );
  check(
    "self-closing trkpt is read",
    selfClosing.ok && selfClosing.points.length === 2 && selfClosing.points[1].lng === -84.1409,
    selfClosing.ok ? "" : selfClosing.reason,
  );
  check("self-closing trkpt has no time, so hasTimes is false", selfClosing.ok && selfClosing.hasTimes === false);

  const reversed = GPX.parseGpx(`<gpx><trkpt lon='-84.1408' lat='9.9187'></trkpt></gpx>`);
  check(
    "attribute order reversed and single quotes both read",
    reversed.ok && reversed.points[0].lat === 9.9187 && reversed.points[0].lng === -84.1408,
    reversed.ok ? "" : reversed.reason,
  );

  // A GPX where only some points are timed cannot be half-trusted: the file is
  // demoted to untimed and the partial stamps are dropped, so hasTimes === false
  // means no point has a t at all.
  const partial = GPX.parseGpx(
    `<gpx><trkseg>
      <trkpt lat="9.9187" lon="-84.1408"><time>2026-07-16T14:00:00Z</time></trkpt>
      <trkpt lat="9.9188" lon="-84.1408"></trkpt>
    </trkseg></gpx>`,
  );
  check("a partially timed GPX is demoted to untimed", partial.ok && partial.hasTimes === false);
  check(
    "a demoted GPX carries no leftover timestamps",
    partial.ok && partial.points.every((p) => p.t === undefined),
  );

  const badTime = GPX.parseGpx(
    `<gpx><trkpt lat="9.9187" lon="-84.1408"><time>not-a-date</time></trkpt></gpx>`,
  );
  check(
    "an unparseable time makes the point untimed, not invalid",
    badTime.ok && badTime.hasTimes === false && badTime.points[0].lat === 9.9187,
    badTime.ok ? "" : badTime.reason,
  );

  /* ---------------- GPX: the failures ---------------- */

  check("an empty string is not_gpx", GPX.parseGpx("").ok === false && GPX.parseGpx("").reason === "not_gpx");
  check(
    "arbitrary XML is not_gpx",
    GPX.parseGpx("<kml><Placemark/></kml>").reason === "not_gpx",
  );
  check(
    "a GPX with no trackpoints is no_trackpoints",
    GPX.parseGpx(`<gpx version="1.1"><metadata><name>empty</name></metadata></gpx>`).reason ===
      "no_trackpoints",
  );
  check(
    "latitude past the pole is malformed_coordinates",
    GPX.parseGpx(`<gpx><trkpt lat="91" lon="0"/></gpx>`).reason === "malformed_coordinates",
  );
  check(
    "longitude past the antimeridian is malformed_coordinates",
    GPX.parseGpx(`<gpx><trkpt lat="0" lon="-181"/></gpx>`).reason === "malformed_coordinates",
  );
  check(
    "a non-numeric coordinate is malformed_coordinates",
    GPX.parseGpx(`<gpx><trkpt lat="north" lon="0"/></gpx>`).reason === "malformed_coordinates",
  );
  check(
    "a trkpt missing lon is malformed_coordinates",
    GPX.parseGpx(`<gpx><trkpt lat="9.9"/></gpx>`).reason === "malformed_coordinates",
  );
  check(
    "one bad point rejects the whole file rather than silently cutting a corner",
    GPX.parseGpx(
      `<gpx><trkpt lat="9.9187" lon="-84.1408"/><trkpt lat="999" lon="0"/></gpx>`,
    ).reason === "malformed_coordinates",
  );

  /* ---------------- Distance ---------------- */

  // Escazu town centre to a point ~1 km north. Reference computed independently
  // from the spherical law of cosines, so this is not the same formula grading
  // its own homework.
  const escazu = { lat: 9.9187, lng: -84.1408 };
  const kmNorth = { lat: 9.92769, lng: -84.1408 };
  check(
    "pathLengthMeters matches a known 1 km separation",
    near(R.pathLengthMeters([escazu, kmNorth]), 1_000, 2),
    `${R.pathLengthMeters([escazu, kmNorth]).toFixed(1)} m`,
  );
  check("pathLengthMeters sums pairwise legs", near(R.pathLengthMeters([escazu, kmNorth, escazu]), 2_000, 4));
  check("pathLengthMeters of one vertex is zero", R.pathLengthMeters([escazu]) === 0);
  check("pathLengthMeters of an empty path is zero", R.pathLengthMeters([]) === 0);

  /* ---------------- Distributing time along a path ---------------- */

  // Three evenly spaced vertices on a straight meridian: the middle one sits at
  // half the distance, so it must land on half the time.
  const straight = [
    { lat: 9.9187, lng: -84.1408 },
    { lat: 9.91879, lng: -84.1408 },
    { lat: 9.91888, lng: -84.1408 },
  ];
  const START = 1_800_000_000_000;
  const END = START + 20_000;
  const dist = R.distributeTimesAlongPath(straight, START, END);

  check("every vertex gets a timestamp", dist.length === 3);
  check("the first vertex lands exactly on startT", dist[0].t === START);
  check("the last vertex lands exactly on endT", dist[dist.length - 1].t === END);
  check(
    "an evenly spaced midpoint lands on the midpoint time",
    near(dist[1].t, START + 10_000, 5),
    `${dist[1].t - START} ms in`,
  );
  check("times ascend strictly", dist[0].t < dist[1].t && dist[1].t < dist[2].t);
  check("geometry is carried through untouched", dist[1].lat === 9.91879 && dist[1].lng === -84.1408);
  check(
    "no accuracy is invented, so validateTrack keeps every fix",
    dist.every((p) => p.accuracy === undefined),
  );
  check("distributed times carry no non-finite numbers", !hasNonFinite(dist));

  const validated = T.validateTrack(dist, "trace");
  check("the result is a valid trace track", validated.ok === true, validated.ok ? "" : validated.reason);
  check("no fix is dropped by the accuracy filter", validated.ok && validated.dropped === 0);

  // Unevenly spaced: the middle vertex is 90% of the way along, so it must get
  // 90% of the time, not 50%. This is the whole reason we weight by distance.
  const uneven = [
    { lat: 9.9187, lng: -84.1408 },
    { lat: 9.92769, lng: -84.1408 },
    { lat: 9.929689, lng: -84.1408 },
  ];
  const unevenDist = R.distributeTimesAlongPath(uneven, 0, 10_000);
  check(
    "an unevenly spaced vertex is timed by distance, not by index",
    unevenDist[1].t > 7_000 && unevenDist[1].t < 9_500,
    `${unevenDist[1].t} ms of 10000`,
  );

  /* ---------------- Distributing time: the degenerate inputs ---------------- */

  check("an empty path distributes to an empty track", R.distributeTimesAlongPath([], START, END).length === 0);
  const single = R.distributeTimesAlongPath([escazu], START, END);
  check("a single vertex gets startT and comes back alone", single.length === 1 && single[0].t === START);
  check(
    "a single vertex is not a track, and validateTrack says so",
    T.validateTrack(single, "trace").ok === false,
  );

  const coincident = R.distributeTimesAlongPath([escazu, escazu, escazu, escazu], 0, 30_000);
  check("coincident vertices spread evenly by index rather than dividing by zero", coincident.length === 4);
  check("a zero-length path produces no NaN", !hasNonFinite(coincident));
  check(
    "the even index spread hits the expected thirds",
    coincident[0].t === 0 &&
      near(coincident[1].t, 10_000, 1) &&
      near(coincident[2].t, 20_000, 1) &&
      coincident[3].t === 30_000,
    coincident.map((p) => p.t).join(", "),
  );

  const inverted = R.distributeTimesAlongPath(straight, START, START - 5_000);
  check(
    "endT before startT clamps the span to zero rather than running time backwards",
    inverted.every((p) => p.t === START),
  );
  check("an inverted span produces no NaN", !hasNonFinite(inverted));
  check(
    "a zero-span track still sorts and validates as a trace",
    T.validateTrack(inverted, "trace").ok === true,
  );

  /* ---------------- The round trip: vertices in, frames out ---------------- */

  // The inversion's payoff: nothing here knows the track was synthesized.
  const track = T.validateTrack(R.distributeTimesAlongPath(straight, START, END), "trace");
  const mid = track.ok ? T.interpolateAt(track.track, START + 10_000) : null;
  check(
    "interpolateAt at the midpoint time returns the midpoint vertex",
    mid !== null && near(mid.lat, 9.91879, 1e-6) && near(mid.lng, -84.1408, 1e-9),
    mid ? `${mid.lat.toFixed(6)}, ${mid.lng.toFixed(6)}` : "null",
  );
  check(
    "interpolateAt a quarter in lands on the path between vertices",
    (() => {
      const q = track.ok ? T.interpolateAt(track.track, START + 5_000) : null;
      return q !== null && q.lat > 9.9187 && q.lat < 9.91879 && !hasNonFinite(q);
    })(),
  );
  check(
    "a frame shot before the video started is not placed",
    track.ok && T.interpolateAt(track.track, START - 1) === null,
  );
  check(
    "a frame shot after the video ended is not placed",
    track.ok && T.interpolateAt(track.track, END + 1) === null,
  );

  /* ---------------- positionAtFraction ---------------- */

  check("positionAtFraction of an empty path is null", R.positionAtFraction([], 0.5) === null);
  check(
    "fraction 0 is the first vertex",
    (() => {
      const p = R.positionAtFraction(straight, 0);
      return p.lat === 9.9187 && p.lng === -84.1408;
    })(),
  );
  check(
    "fraction 1 is the last vertex",
    (() => {
      const p = R.positionAtFraction(straight, 1);
      return near(p.lat, 9.91888, 1e-9);
    })(),
  );
  check(
    "fraction 0.5 is the midpoint of an evenly spaced path",
    (() => {
      const p = R.positionAtFraction(straight, 0.5);
      return near(p.lat, 9.91879, 1e-6) && !hasNonFinite(p);
    })(),
    `${R.positionAtFraction(straight, 0.5).lat}`,
  );
  check(
    "fraction 0.5 measures by distance on an uneven path, so it sits early",
    (() => {
      const p = R.positionAtFraction(uneven, 0.5);
      return p.lat > 9.9187 && p.lat < 9.92769;
    })(),
  );
  check("an overshooting fraction clamps to the end", near(R.positionAtFraction(straight, 9).lat, 9.91888, 1e-9));
  check("an undershooting fraction clamps to the start", R.positionAtFraction(straight, -3).lat === 9.9187);
  check("a NaN fraction reads as 0 rather than returning NaN", R.positionAtFraction(straight, Number.NaN).lat === 9.9187);
  check(
    "a zero-length path returns its only place, not NaN",
    (() => {
      const p = R.positionAtFraction([escazu, escazu], 0.5);
      return p.lat === escazu.lat && !hasNonFinite(p);
    })(),
  );
  check("a one-vertex path returns that vertex", R.positionAtFraction([escazu], 0.7).lat === escazu.lat);

  /* ---------------- GPX to track, the full import path ---------------- */

  const imported = timed.ok
    ? T.validateTrack(
        timed.points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t })),
        "gpx",
      )
    : { ok: false };
  check("a timed GPX validates straight through as a gpx track", imported.ok === true);
  check(
    "an untimed GPX's geometry can be timed by the route maths instead",
    (() => {
      if (!untimed.ok) return false;
      const t = T.validateTrack(R.distributeTimesAlongPath(untimed.points, START, END), "gpx");
      return t.ok === true && t.track[0].t === START && !hasNonFinite(t.track);
    })(),
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(TSCONFIG, { force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — GPX parse and route distribution locked"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
