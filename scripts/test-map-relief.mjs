#!/usr/bin/env node
/**
 * test-map-relief.mjs (bgsd-0018) — the /map dimensional view.
 *
 * Compiles the real modules and DRIVES them. Nothing here greps source: every
 * assertion below runs the shipped code and reads what it actually returned.
 *
 * What this suite owns:
 *   1. The persistence decision table (lib/map-relief.ts). Every reachable
 *      cookie state, in both directions, plus the round trip through the
 *      writer: an "off" choice must resolve to off AND suppress the fly-in on
 *      the next visit, and a seen-flag must suppress it without turning the
 *      relief off. This is the whole contract for "the off choice persists" and
 *      "first time only".
 *   2. The relief geometry (components/scoreRelief.ts) built over the REAL demo
 *      payload: the map cannot initialise with the relief present if the
 *      collection is empty or malformed, so this is that requirement's data
 *      half. Also locks the honesty contract (nothing unaudited is extruded)
 *      and the direction rule (a better street is taller), on every lens.
 *
 * What it deliberately does NOT own: anything needing a browser. `npm test`
 * runs with no server and no GPU, so the four live-DOM behaviours — the relief
 * present on a real map, the control's rendered state matching the map's actual
 * state both ways, a persisted off-choice surviving a reload, and a persisted
 * seen-flag suppressing the animation — are asserted against a running build by
 * scripts/verify-map-relief.mjs, which counts real camera-API calls rather than
 * trusting the source. This file locks the logic those behaviours are built on.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-map-relief");
// The temp project lives at ROOT so its relative `extends` and `paths` resolve
// exactly as the real tsconfig does — scoreRelief.ts imports types across the
// "@/" alias, and a detached tsconfig would fail to resolve them.
const TS_PROJECT = path.join(ROOT, "tsconfig.test-map-relief.json");
const require = createRequire(import.meta.url);

const LENSES = ["overall", "accessibility", "drainage", "shade", "bike"];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * A minimal document/location stand-in so the cookie writer can be driven for
 * real. `document.cookie` is a setter that APPENDS in a browser, so the shim
 * keeps a jar and re-serializes it, which is what makes the round-trip test
 * below meaningful rather than a string comparison.
 */
function installCookieJar() {
  const jar = new Map();
  globalThis.location = { protocol: "http:" };
  globalThis.document = {
    set cookie(raw) {
      const [pair] = String(raw).split(";");
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    },
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
  return {
    read: (name) => jar.get(name),
    clear: () => jar.clear(),
    uninstall: () => {
      delete globalThis.document;
      delete globalThis.location;
    },
  };
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  writeFileSync(
    TS_PROJECT,
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          noEmit: false,
          outDir: path.relative(ROOT, BUILD_DIR),
          module: "commonjs",
          moduleResolution: "node",
          target: "es2019",
          declaration: false,
          incremental: false,
        },
        // `include` MUST be cleared: `extends` inherits the base config's
        // "**/*.ts" glob, and `files` does not override it.
        include: [],
        files: ["lib/map-relief.ts", "components/scoreRelief.ts"],
      },
      null,
      2,
    ) + "\n",
  );

  try {
    execFileSync("npx", ["tsc", "--project", path.basename(TS_PROJECT)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    const V = require(path.join(BUILD_DIR, "lib", "map-relief.js"));
    // scoreRelief imports only types, so it emits with no requires.
    const R = require(path.join(BUILD_DIR, "components", "scoreRelief.js"));

    console.log("");
    console.log("persistence — the dimensional view survives the visit");

    // 1. First arrival: relief on, and the establishing move plays.
    {
      const v = V.resolveMapReliefView(undefined);
      check(
        "no cookie -> relief on, animate",
        v.relief === true && v.animate === true,
        JSON.stringify(v),
      );
    }

    // 2. FIRST TIME ONLY. Having seen it must suppress the move without
    //    touching the relief itself.
    {
      const v = V.resolveMapReliefView(V.MAP_RELIEF_ON);
      check(
        "seen flag -> relief on, NO animation",
        v.relief === true && v.animate === false,
        JSON.stringify(v),
      );
    }

    // 3. THE OFF CHOICE PERSISTS, and never resurrects the fly-in.
    {
      const v = V.resolveMapReliefView(V.MAP_RELIEF_OFF);
      check(
        "off choice -> relief off, NO animation",
        v.relief === false && v.animate === false,
        JSON.stringify(v),
      );
    }

    // 4. A corrupt or stale value degrades to the DEFAULT view, not to off.
    //    Silently hiding the product's default because a cookie got truncated
    //    would be the worst of the failure modes.
    for (const bad of ["", "1", "true", "ON", "yes", null]) {
      const v = V.resolveMapReliefView(bad);
      check(
        `unrecognised cookie ${JSON.stringify(bad)} -> first-arrival default`,
        v.relief === true && v.animate === true,
      );
    }

    // 5. ROUND TRIP. Write the choice the way the toggle writes it, read it
    //    back the way the server reads it. Both directions, and the reload in
    //    between is the whole point of the mechanism.
    {
      const jar = installCookieJar();
      try {
        V.writeMapReliefPreference(false);
        const stored = jar.read(V.MAP_RELIEF_COOKIE);
        const afterReload = V.resolveMapReliefView(stored);
        check(
          "turn off -> reload -> still off, still no fly-in",
          afterReload.relief === false && afterReload.animate === false,
          `cookie=${stored}`,
        );

        V.writeMapReliefPreference(true);
        const back = V.resolveMapReliefView(jar.read(V.MAP_RELIEF_COOKIE));
        check(
          "turn back on -> reload -> on, and STILL no fly-in",
          back.relief === true && back.animate === false,
          `cookie=${jar.read(V.MAP_RELIEF_COOKIE)}`,
        );

        // The cookie has to survive a navigation to any path and outlive the
        // tab, or "persists across navigations and reloads" is not true.
        jar.clear();
        V.writeMapReliefPreference(true);
        const raw = globalThis.document.cookie;
        check("cookie is written at all", raw.includes(V.MAP_RELIEF_COOKIE), raw);
      } finally {
        jar.uninstall();
      }
    }

    // 6. The writer must not throw where cookies are unavailable (SSR, a
    //    hardened browser). Losing the preference is acceptable; taking the map
    //    down with it is not.
    {
      let threw = false;
      try {
        V.writeMapReliefPreference(true);
      } catch {
        threw = true;
      }
      check("writer is a no-op with no document (never throws)", !threw);
    }

    console.log("");
    console.log("geometry — the relief the map actually initialises with");

    const demo = JSON.parse(
      readFileSync(path.join(ROOT, "data", "demo-segments.geojson"), "utf8"),
    );
    const relief = R.buildReliefCollection(demo);

    check(
      "the demo era extrudes a real network",
      relief.type === "FeatureCollection" && relief.features.length > 0,
      `${relief.features.length} volumes from ${demo.features.length} segments`,
    );

    check(
      "every volume is a closed polygon ring",
      relief.features.every((f) => {
        const ring = f.geometry?.coordinates?.[0];
        if (f.geometry?.type !== "Polygon" || !Array.isArray(ring)) return false;
        if (ring.length < 4) return false;
        const [ax, ay] = ring[0];
        const [bx, by] = ring[ring.length - 1];
        return ax === bx && ay === by;
      }),
    );

    // A volume has to be addressable by segment id, or hover, selection and
    // click-to-open cannot cross from the line to the body of the street.
    {
      const ids = new Set(demo.features.map((f) => f.properties.id));
      check(
        "every volume carries its segment id, as a feature id and a property",
        relief.features.every(
          (f) => typeof f.id === "string" && f.id === f.properties.id && ids.has(f.id),
        ),
      );
      check(
        "volume ids are unique (one body per street)",
        new Set(relief.features.map((f) => f.id)).size === relief.features.length,
      );
    }

    // Every lens's score travels with the volume, which is what lets the lens
    // switcher repaint AND re-height the relief without rebuilding it.
    check(
      "every volume carries all five lens scores",
      relief.features.every((f) =>
        LENSES.every((l) => typeof f.properties[`score_${l}`] === "number"),
      ),
    );

    // THE HONESTY CONTRACT: nothing unaudited is ever given a height.
    {
      const byId = new Map(demo.features.map((f) => [f.properties.id, f.properties]));
      const unaudited = relief.features.filter((f) => {
        const p = byId.get(f.id);
        if (!p) return true;
        if (p.score_overall <= 0) return true;
        const community = p.source === "community" || p.source === "import";
        return community && !(p.cv_count > 0);
      });
      check(
        "nothing unaudited or unscored is extruded",
        unaudited.length === 0,
        `${unaudited.length} offenders`,
      );
    }

    // THE DIRECTION RULE, on every lens: a better street is taller. Read the
    // height expression the map is actually given and evaluate it.
    for (const lens of LENSES) {
      const expr = R.reliefHeightExpression(lens);
      const [op, base, [mul, slope, [get, prop]]] = expr;
      const at = (score) => base + slope * score;
      check(
        `${lens}: height reads score_${lens} and grows with it (${at(0)} → ${at(100)} m)`,
        op === "+" &&
          mul === "*" &&
          get === "get" &&
          prop === `score_${lens}` &&
          at(100) > at(0) &&
          at(0) > 0,
      );
    }

    // THE REAL-DATA ERA: no published audits means no invented heights. This is
    // the "demo data OFF reads as deliberate, not broken" case at the data
    // layer — an empty collection, never a field of zero-height slabs.
    {
      const flat = {
        type: "FeatureCollection",
        features: demo.features.map((f) => ({
          ...f,
          properties: Object.fromEntries(
            Object.entries(f.properties).map(([k, v]) =>
              k.startsWith("score_") ? [k, 0] : [k, v],
            ),
          ),
        })),
      };
      const empty = R.buildReliefCollection(flat);
      check(
        "an unscored era extrudes NOTHING (no zero-height slabs)",
        empty.features.length === 0,
        `${empty.features.length} volumes`,
      );
    }

    // Degenerate geometry must be dropped, not emitted as a broken ring.
    {
      const degenerate = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { id: "dupe", source: "audit", score_overall: 80 },
            geometry: { type: "LineString", coordinates: [[-84.1, 9.9], [-84.1, 9.9]] },
          },
        ],
      };
      check(
        "a zero-length segment is dropped rather than extruded",
        R.buildReliefCollection(degenerate).features.length === 0,
      );
    }
  } finally {
    rmSync(BUILD_DIR, { recursive: true, force: true });
    rmSync(TS_PROJECT, { force: true });
  }

  console.log("");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("PASS — the /map dimensional view holds its contract");
}

main();
