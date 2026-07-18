#!/usr/bin/env node
/**
 * test-synthesis.mjs (u1 segment synthesis engine)
 *
 * Locks the PURE core of the synthesis engine — the parts that reason without a
 * network: the evidence the model reads, and the arithmetic applied to what it
 * writes back. Nothing here touches OpenAI or a bill; the one model call is a
 * scripted client.
 *
 * The cases that matter are the ones a plausible implementation gets subtly
 * wrong: an average that hides a crosswalk vanishing halfway along a block, an
 * unbounded score rewrite, a lens conjured for a street no frame could see, an
 * "overall" copied from the model instead of recomputed. Each of those would
 * produce a number that looks trustworthy and is not.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-synthesis");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        rootDir: "../lib",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2022",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: [
        "../lib/extraction/synthesis.ts",
        "../lib/extraction/config.ts",
        "../lib/extraction/client.ts",
        "../lib/extraction/prompt.ts",
        "../lib/extraction/schema.ts",
        "../lib/capture/types.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/schemas.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  // tsc emits the "@/" specifiers verbatim; map them at require time.
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/lib/")) {
      return originalResolve.call(
        this,
        path.join(BUILD_DIR, request.slice("@/lib/".length)),
        ...rest,
      );
    }
    return originalResolve.call(this, request, ...rest);
  };
}

/* -------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------- */

/** One synthesis frame with all 15 items at a value, overriding some. */
function frame(T, { seq, lng, lat, nearJunction = false, usable = true, value = 3, overrides = {}, rationale = "note" }) {
  const items = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    const v = value === null ? null : rt === "boolean" ? 1 : rt === "percent" ? 50 : value;
    items[key] = { value: v, confidence: 0.9 };
  }
  for (const [k, v] of Object.entries(overrides)) items[k] = v;
  return {
    seq,
    location: lng === undefined || lat === undefined ? null : { lng, lat },
    nearJunction,
    usable,
    items,
    rationale,
  };
}

/** A valid model draft, with adjustment overrides. */
function draft(adjust = {}) {
  const base = (d = 0, reason = "") => ({ delta: d, reason });
  return {
    overall: "A nuanced verdict about the whole segment.",
    lenses: {
      accessibility: "accessibility prose",
      drainage: "drainage prose",
      shade: "shade prose",
      bike: "bike prose",
    },
    adjustments: {
      accessibility: adjust.accessibility ?? base(),
      drainage: adjust.drainage ?? base(),
      shade: adjust.shade ?? base(),
      bike: adjust.bike ?? base(),
    },
    overall_es: "Un veredicto matizado sobre todo el segmento.",
    lenses_es: {
      accessibility: "prosa de accesibilidad",
      drainage: "prosa de drenaje",
      shade: "prosa de sombra",
      bike: "prosa de bicicleta",
    },
  };
}

/** A scripted synthesis client. */
function makeSynthesis(responder) {
  const calls = [];
  return {
    calls,
    async synthesize(request) {
      calls.push(request);
      return responder(request, calls.length - 1);
    },
  };
}
const okResponse = (obj, usage = { inputTokens: 400, outputTokens: 120, cachedTokens: 0 }) => ({
  outcome: "completed",
  text: JSON.stringify(obj),
  detail: null,
  usage,
});

async function main() {
  compile();
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));
  const S = require(path.join(BUILD_DIR, "capture", "scoring.js"));
  const SYN = require(path.join(BUILD_DIR, "extraction", "synthesis.js"));

  process.env.CV_EXTRACTION_ENABLED = "true";
  delete process.env.CV_SYNTHESIS_MAX_ADJUST;

  /* ---------------- Geometry ---------------- */
  console.log("\nhaversine distance");
  {
    // One degree of latitude is ~111 km; a small step near the equator.
    const d = SYN.haversineMeters({ lng: -84.15, lat: 9.9 }, { lng: -84.15, lat: 9.901 });
    check("0.001 deg latitude is ~111 m", near(d, 111, 2), `${d.toFixed(1)} m`);
    check("distance to self is zero", SYN.haversineMeters({ lng: 1, lat: 1 }, { lng: 1, lat: 1 }) === 0);
  }

  /* ---------------- Evidence: the crosswalk gap ---------------- */
  console.log("\nevidence encodes cross-frame continuity (the crosswalk gap)");
  {
    // A crosswalk at the top of the block, then none for a long stretch — the
    // exact case the user said an average must not hide. Frame 0 sits at a
    // junction with a marked crossing; the next frames walk 300 m with none.
    const frames = [
      frame(T, {
        seq: 0,
        lng: -84.150,
        lat: 9.9000,
        nearJunction: true,
        overrides: { crossing_safety: { value: 3, confidence: 0.9 }, curb_ramp: { value: 1, confidence: 0.9 } },
        rationale: "Junction with a clearly marked crossing and a curb ramp.",
      }),
      frame(T, {
        seq: 1,
        lng: -84.150,
        lat: 9.9010,
        overrides: { crossing_safety: { value: null, confidence: 0.9 }, curb_ramp: { value: null, confidence: 0.9 } },
      }),
      frame(T, {
        seq: 2,
        lng: -84.150,
        lat: 9.9020,
        overrides: { crossing_safety: { value: null, confidence: 0.9 }, curb_ramp: { value: null, confidence: 0.9 } },
      }),
      frame(T, {
        seq: 3,
        lng: -84.150,
        lat: 9.9027,
        overrides: { crossing_safety: { value: null, confidence: 0.9 }, curb_ramp: { value: null, confidence: 0.9 } },
      }),
    ];
    const input = {
      segmentId: "north-st",
      frames,
      baselineScores: { overall: 60, accessibility: 70, drainage: 55, shade: 40, bike: 30 },
      itemMedians: { crossing_safety: { value: 3, confidence: 0.9, frames: 1 } },
    };
    const evidence = SYN.buildSynthesisEvidence(input);

    check("the evidence names the segment", evidence.includes("SEGMENT north-st"));
    check(
      "the baseline scores the model may adjust are stated",
      evidence.includes("accessibility=70") && evidence.includes("bike=30"),
    );
    check(
      "each frame carries its distance along the walk",
      /#0 @0m/.test(evidence) && /#3 @[\d.]+m/.test(evidence),
      evidence.split("\n").find((l) => l.includes("#3")),
    );
    check(
      "frames appear in traversal order",
      evidence.indexOf("#0 ") < evidence.indexOf("#1 ") &&
        evidence.indexOf("#1 ") < evidence.indexOf("#3 "),
    );
    check("the junction frame is flagged as a junction", /#0[^\n]*JUNCTION/.test(evidence));

    // The heart of it: a continuity line that says crossing_safety was present
    // once then not-assessable for the rest of the walk, WITH the distance.
    const contLine = evidence.split("\n").find((l) => l.trim().startsWith("crossing_safety:"));
    check(
      "a continuity line is emitted for crossing_safety (it changed along the walk)",
      !!contLine,
      contLine,
    );
    check(
      "the continuity line encodes the crosswalk THEN the long gap",
      !!contLine && /present/.test(contLine) && /unknown/.test(contLine),
      contLine,
    );
    check(
      "the gap carries the distance it spans, so the model can weight it",
      !!contLine && /\d+m/.test(contLine),
      contLine,
    );
    // A uniformly-present item (drain_present is 1 on every frame) carries no
    // transition, so spelling it out would be tokens for nothing.
    check(
      "an item that never changes gets no continuity line",
      !evidence.split("\n").some((l) => l.trim().startsWith("drain_present:")),
    );
  }

  /* ---------------- Evidence: unplaced frames ---------------- */
  console.log("\nevidence tolerates unplaced frames");
  {
    const frames = [
      frame(T, { seq: 0, lng: -84.15, lat: 9.9 }),
      frame(T, { seq: 1 }), // no location
      frame(T, { seq: 2, lng: -84.15, lat: 9.901 }),
    ];
    const evidence = SYN.buildSynthesisEvidence({
      segmentId: "s",
      frames,
      baselineScores: { overall: 50, accessibility: 50, drainage: 50, shade: 50, bike: 50 },
      itemMedians: {},
    });
    check("an unplaced frame is shown with an unknown position, not dropped", /#1 @\?/.test(evidence));
    check("placed frames still accumulate distance around it", /#2 @[\d.]+m/.test(evidence));
  }

  /* ---------------- applyAssessment: the four rules ---------------- */
  console.log("\napplyAssessment bounds and recompute");
  const baseline = { overall: 60, accessibility: 70, drainage: 50, shade: 40, bike: null };

  {
    // Clamp: a wild +999 is capped at the default 20-point bound.
    const a = SYN.applyAssessment(
      draft({ accessibility: { delta: 999, reason: "sidewalk vanishes for 200 m" } }),
      baseline,
      "test-model",
      20,
    );
    check(
      "a delta beyond the bound is clamped, not applied whole",
      a.adjustments.accessibility.delta === 20,
      `${a.adjustments.accessibility.delta}`,
    );
    check(
      "adjustedScores = clamp(baseline + bounded delta)",
      a.adjustedScores.accessibility === 90,
      `${a.adjustedScores.accessibility}`,
    );
    check("a negative wild delta clamps the other way too", (() => {
      const b = SYN.applyAssessment(
        draft({ drainage: { delta: -999, reason: "no drain the whole hill" } }),
        baseline,
        "m",
        20,
      );
      return b.adjustedScores.drainage === 30 && b.adjustments.drainage.delta === -20;
    })());
  }

  {
    // A null-baseline lens stays null — synthesis cannot invent a score for a
    // lens no frame could assess, however confidently it argues.
    const a = SYN.applyAssessment(
      draft({ bike: { delta: 15, reason: "great bike lane" } }),
      baseline,
      "m",
      20,
    );
    check("a lens with a null baseline stays null", a.adjustedScores.bike === null);
    check("and records no adjustment for it", a.adjustments.bike === undefined);
  }

  {
    // An unexplained non-zero delta is dropped to zero: no number moves without a
    // written reason.
    const a = SYN.applyAssessment(
      draft({ accessibility: { delta: 12, reason: "   " } }),
      baseline,
      "m",
      20,
    );
    check("an adjustment with no reason does not apply", a.adjustedScores.accessibility === 70);
    check("and is not recorded as an adjustment", a.adjustments.accessibility === undefined);
  }

  {
    // overall is recomputed from the ADJUSTED lenses, never the model's prose.
    const a = SYN.applyAssessment(
      draft({
        accessibility: { delta: 10, reason: "continuous sidewalk" },
        shade: { delta: -10, reason: "canopy thins out" },
      }),
      baseline,
      "m",
      20,
    );
    const expected = S.renormalizedOverall(
      a.adjustedScores.accessibility,
      a.adjustedScores.drainage,
      a.adjustedScores.shade,
    );
    check(
      "overall is recomputed with the 0.45/0.30/0.25 formula, not copied",
      near(a.adjustedScores.overall, Math.round(expected * 100) / 100),
      `${a.adjustedScores.overall} vs ${expected}`,
    );
    check(
      "moving the lenses moves overall off the baseline",
      a.adjustedScores.overall !== baseline.overall,
      `${a.adjustedScores.overall}`,
    );
    check("the model's prose fields survive verbatim", a.overall === "A nuanced verdict about the whole segment.");
    check("the model id is stamped", a.model === "m");
  }

  {
    // CV_SYNTHESIS_MAX_ADJUST widens/narrows the bound.
    process.env.CV_SYNTHESIS_MAX_ADJUST = "5";
    const { synthesisMaxAdjust } = require(path.join(BUILD_DIR, "extraction", "config.js"));
    check("CV_SYNTHESIS_MAX_ADJUST overrides the bound", synthesisMaxAdjust() === 5);
    const a = SYN.applyAssessment(
      draft({ accessibility: { delta: 50, reason: "x" } }),
      baseline,
      "m",
      synthesisMaxAdjust(),
    );
    check("the tighter bound is enforced", a.adjustments.accessibility.delta === 5);
    delete process.env.CV_SYNTHESIS_MAX_ADJUST;
  }

  /* ---------------- synthesizeSegment: outcomes ---------------- */
  console.log("\nsynthesizeSegment outcomes");
  const segInput = {
    segmentId: "s",
    frames: [frame(T, { seq: 0, lng: -84.15, lat: 9.9 })],
    baselineScores: baseline,
    itemMedians: {},
  };

  {
    const client = makeSynthesis(() =>
      okResponse(draft({ accessibility: { delta: 8, reason: "sidewalk is continuous" } })),
    );
    const out = await SYN.synthesizeSegment(client, segInput, { model: "m", maxAdjust: 20 });
    check("a valid answer yields kind=ok", out.kind === "ok", out.kind);
    check("the bounded adjustment is applied end to end", out.kind === "ok" && out.assessment.adjustedScores.accessibility === 78);
    check("usage is reported for the ledger", out.kind === "ok" && out.usage.inputTokens === 400);
    check(
      "Spanish prose companion is extracted from the same call",
      out.kind === "ok" && out.assessmentEs?.overall === "Un veredicto matizado sobre todo el segmento.",
    );
    check(
      "the request is text-only, carrying the evidence and the strict format",
      client.calls[0].user.includes("SEGMENT s") && client.calls[0].format.strict === true,
    );
    const body = SYN.buildSynthesisRequestBody(client.calls[0]);
    check("synthesis request bounds max_output_tokens", typeof body.max_output_tokens === "number" && body.max_output_tokens > 0);
  }

  {
    const client = makeSynthesis(() => ({ outcome: "refusal", text: null, detail: "no", usage: { inputTokens: 5, outputTokens: 0, cachedTokens: 0 } }));
    const out = await SYN.synthesizeSegment(client, segInput, { model: "m", maxAdjust: 20 });
    check("a refusal is a clean failure, not a throw", out.kind === "failed" && /refusal/.test(out.reason), out.reason);
  }

  {
    const client = makeSynthesis(() => okResponse({ overall: "x" })); // missing lenses/adjustments
    const out = await SYN.synthesizeSegment(client, segInput, { model: "m", maxAdjust: 20 });
    check("a malformed draft is rejected by the zod mirror", out.kind === "failed" && /schema/.test(out.reason), out.reason);
  }

  {
    const client = makeSynthesis(() => ({ outcome: "completed", text: "{not json", detail: null, usage: { inputTokens: 3, outputTokens: 0, cachedTokens: 0 } }));
    const out = await SYN.synthesizeSegment(client, segInput, { model: "m", maxAdjust: 20 });
    check("unparsable output fails rather than throwing", out.kind === "failed" && /json_parse/.test(out.reason), out.reason);
  }

  {
    const client = { async synthesize() { throw new Error("ECONNRESET"); } };
    const out = await SYN.synthesizeSegment(client, segInput, { model: "m", maxAdjust: 20 });
    check("a transport throw is caught as a failure reporting no spend", out.kind === "failed" && out.usage.inputTokens === 0 && /transport/.test(out.reason), out.reason);
  }

  /* ---------------- The strict response format ---------------- */
  console.log("\nstrict response format");
  {
    const fmt = SYN.synthesisResponseFormat(20);
    check("structured output is strict", fmt.strict === true);
    check("it demands overall, lenses, adjustments, and ES companions", ["overall", "lenses", "adjustments", "overall_es", "lenses_es"].every((k) => fmt.schema.required.includes(k)));
    check(
      "adjustments requires all four adjustable lenses",
      ["accessibility", "drainage", "shade", "bike"].every((k) => fmt.schema.properties.adjustments.required.includes(k)),
    );
    check(
      "each adjustment demands a delta and a reason",
      fmt.schema.properties.adjustments.properties.accessibility.required.join(",") === "delta,reason",
    );
    const body = SYN.buildSynthesisRequestBody({ model: "m", system: "sys", user: "usr", format: fmt });
    check("no temperature — the reasoning models reject it", !("temperature" in body));
    check("the system prompt rides in instructions", body.instructions === "sys");
    check("the strict format is passed through", body.text.format === fmt);
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — segment synthesis engine");
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
