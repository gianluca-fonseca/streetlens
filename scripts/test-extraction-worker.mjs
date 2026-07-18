#!/usr/bin/env node
/**
 * test-extraction-worker.mjs (u29 ingest + extraction worker)
 *
 * Drives the REAL pump — claim, extract, escalate, complete, roll up — against
 * an in-memory database and a scripted model. Nothing here touches a network, a
 * database, or a bill.
 *
 * The fake db is not a stub that returns canned values: it enforces the parts of
 * 0013/0015 the worker's correctness depends on, above all the SKIP LOCKED claim
 * (mutating synchronously before yielding, which is what a row lock buys you in
 * a single-threaded runtime). If it were looser, the concurrency case below
 * would pass without proving anything.
 *
 * The one exception is the image downscale, which runs FOR REAL against the
 * committed fixture — only the fetch is faked. A mocked resize would prove
 * nothing about the thing that costs money (the pixels that reach the model),
 * which is precisely what the live smoke caught us being wrong about.
 *
 * Covers: the happy path, the cost breaker, the per-session budget, escalation
 * and its cap, refusal/incomplete handling, concurrent pump safety, the attempts
 * cap, the kill switch, and the frame downscale.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-extraction");
const FIXTURE = path.join(__dirname, "fixtures", "street-san-antonio-escazu.jpg");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------- *
 * Compile
 * -------------------------------------------------------------- */

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        // Pinned, not inferred: tsc derives rootDir from the common ancestor of
        // `files`, so the emit layout would silently move if this list changed.
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
        "../lib/extraction/downscale.ts",
        "../lib/capture/pump.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/db.ts",
        "../lib/capture/types.ts",
        "../lib/capture/schemas.ts",
        "../lib/capture/track.ts",
        "../lib/capture/storage.ts",
        "../lib/extraction/extract.ts",
        "../lib/extraction/client.ts",
        "../lib/extraction/config.ts",
        "../lib/extraction/prompt.ts",
        "../lib/extraction/schema.ts",
        "../lib/extraction/synthesis.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  // tsc emits the "@/" specifiers verbatim (it resolves them, it does not
  // rewrite them), so CommonJS needs the same mapping at require time.
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

const SID = "0b8a9a1e-0e6e-4c9a-9f0d-9a1f2b3c4d5e";

/** A full, valid 15-item answer. */
function items(T, { confidence = 0.9, value } = {}) {
  const out = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    const v = value !== undefined ? value : rt === "boolean" ? 1 : rt === "percent" ? 40 : 3;
    out[key] = { value: v, confidence };
  }
  return out;
}

/** The default rationale a scripted model "returns"; overridable per case. */
const RATIONALE = "Narrow paved residential street, no sidewalk either side; open gutter at the right edge; scattered canopy overhead.";

function modelText(T, opts = {}) {
  return JSON.stringify({
    schemaVersion: "cv-v1",
    items: items(T, opts),
    frameQuality: { usable: opts.usable ?? true, reason: opts.reason ?? null },
    rationale: opts.rationale ?? RATIONALE,
  });
}

const USAGE = (input = 1200, output = 300) => ({
  inputTokens: input,
  outputTokens: output,
  cachedTokens: 0,
});

/**
 * An in-memory CaptureDb honouring the bits of 0013/0015 the worker relies on.
 *
 * `claimJobs` mutates SYNCHRONOUSLY before yielding to the event loop — that is
 * the in-process equivalent of FOR UPDATE SKIP LOCKED, and it is what the
 * concurrency case actually tests.
 */
function makeDb({ frameCount = 3, status = "extracting", attempts = {} } = {}) {
  const jobs = new Map();
  const frames = new Map();
  for (let seq = 0; seq < frameCount; seq++) {
    const frameId = `frame-${seq}`;
    frames.set(frameId, {
      seq,
      storage_path: `captures/${SID}/frame-000${seq}.jpg`,
      segment_id: "north-st",
      near_junction: false,
      // Give each frame a distinct position along the walk so synthesis has real
      // distances to reason over (0022 surfaces these through list_observations).
      lng: -84.15,
      lat: 9.9 + seq * 0.0005,
    });
    jobs.set(frameId, { status: "pending", attempts: attempts[seq] ?? 0, error: null });
  }

  const state = {
    sessionStatus: status,
    observations: [],
    rollups: [],
    statusWrites: [],
    /** Session ids filed into the review queue (u30). */
    emits: [],
    /** Ordered trace of emits and status writes, so ordering can be asserted. */
    events: [],
    /** Assessments written by the synthesis drain stage (0022). */
    assessments: [],
    /** Pause reasons passed to setSessionStatus (0025). */
    pauseReasons: [],
  };

  const db = {
    state,
    jobs,
    async claimJobs(limit) {
      // Synchronous critical section: no await before the mutation.
      if (state.sessionStatus !== "extracting") return [];
      const claimed = [];
      for (const [frameId, job] of jobs) {
        if (claimed.length >= limit) break;
        if (job.status !== "pending") continue;
        const frame = frames.get(frameId);
        if (!frame.segment_id) continue;
        job.status = "running";
        job.attempts += 1;
        claimed.push({
          job_id: `job-${frameId}`,
          frame_id: frameId,
          attempts: job.attempts,
          session_id: SID,
          seq: frame.seq,
          storage_path: frame.storage_path,
          segment_id: frame.segment_id,
          near_junction: frame.near_junction,
        });
      }
      await Promise.resolve();
      return claimed;
    },
    async sessionStatus() {
      return {
        status: state.sessionStatus,
        frameCount,
        jobs: { pending: 0, done: 0, failed: 0 },
      };
    },
    async sessionTokenUsage() {
      return {
        inputTokens: state.observations.reduce((s, o) => s + o.inputTokens, 0),
        outputTokens: 0,
        observations: state.observations.length,
        escalated: state.observations.filter((o) => o.escalated).length,
      };
    },
    async completeJob(args) {
      state.observations.push(args);
      jobs.get(args.frameId).status = "done";
    },
    async failJob(frameId, status, error) {
      const job = jobs.get(frameId);
      job.status = status;
      job.error = error;
    },
    async setSessionStatus(_sessionId, s, pauseReason) {
      state.sessionStatus = s;
      state.statusWrites.push(s);
      if (pauseReason) state.pauseReasons = [...(state.pauseReasons ?? []), pauseReason];
      state.events.push(`status:${s}`);
    },
    async pendingJobCount() {
      return [...jobs.values()].filter((j) => j.status === "pending").length;
    },
    async drainedSessions() {
      const busy = [...jobs.values()].some(
        (j) => j.status === "pending" || j.status === "running",
      );
      return busy || state.sessionStatus !== "extracting" ? [] : [SID];
    },
    async listObservations() {
      return state.observations.map((o) => {
        const f = frames.get(o.frameId) ?? {};
        return {
          frame_id: o.frameId,
          segment_id: f.segment_id ?? "north-st",
          model: o.model,
          items: o.items,
          usable: o.usable,
          confidence: o.confidence,
          escalated: o.escalated,
          near_junction: f.near_junction ?? false,
          seq: f.seq ?? 0,
          rationale: o.rationale ?? null,
          lng: f.lng ?? null,
          lat: f.lat ?? null,
        };
      });
    },
    async upsertRollup(r) {
      state.rollups.push(r);
    },
    async setSegmentAssessment(args) {
      state.assessments.push(args);
    },
    async listFrames() {
      return [];
    },
    async attributeFrames() {
      return 0;
    },
    async failUnattributedJobs() {
      return 0;
    },
    async createSession() {
      return SID;
    },
    async registerFrames() {
      return [];
    },
    async finalizeSession() {
      return "matching";
    },
  };
  return db;
}

/**
 * Storage, faked at the fetch boundary — the 960x666 fixture, for any URL.
 *
 * Faked HERE and no higher: everything above it (the resize, the JPEG encode,
 * the data URL) is the real code path, so a test that says "the model was sent
 * 512 px" means it.
 */
function makeFixtureFetch() {
  const bytes = readFileSync(FIXTURE);
  const fetches = [];
  const fetchImpl = async (url) => {
    fetches.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  };
  return { fetchImpl, fetches };
}

/** A model that answers from a script, recording every call. */
function makeVision(responder) {
  const calls = [];
  return {
    calls,
    async extract(request) {
      calls.push(request);
      return responder(request, calls.length - 1);
    },
  };
}

function ok(T, opts = {}) {
  return {
    outcome: "completed",
    text: modelText(T, opts),
    detail: null,
    usage: USAGE(opts.input ?? 1200),
  };
}

/* -------------------------------------------------------------- *
 * Synthesis fakes (0022 drain stage)
 * -------------------------------------------------------------- */

/** A valid synthesis draft with no adjustments; overridable per lens. */
function synthDraft(adjust = {}) {
  const base = (delta = 0, reason = "") => ({ delta, reason });
  return {
    overall: "A nuanced whole-segment verdict.",
    lenses: { accessibility: "a", drainage: "d", shade: "s", bike: "b" },
    adjustments: {
      accessibility: adjust.accessibility ?? base(),
      drainage: adjust.drainage ?? base(),
      shade: adjust.shade ?? base(),
      bike: adjust.bike ?? base(),
    },
  };
}

const synthResponse = (obj, usage = { inputTokens: 200, outputTokens: 80, cachedTokens: 0 }) => ({
  outcome: "completed",
  text: JSON.stringify(obj),
  detail: null,
  usage,
});

/** A synthesis client that answers from a script, recording every call. */
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

/* -------------------------------------------------------------- *
 * Cases
 * -------------------------------------------------------------- */

async function main() {
  compile();
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));
  const { pumpOnce, rollupSession } = require(path.join(BUILD_DIR, "capture", "pump.js"));
  const SCORING = require(path.join(BUILD_DIR, "capture", "scoring.js"));
  const { shouldEscalate, extractFrame } = require(path.join(BUILD_DIR, "extraction", "extract.js"));
  const { parseVisionPayload, buildRequestBody } = require(path.join(BUILD_DIR, "extraction", "client.js"));
  const { SYSTEM_PROMPT, systemPromptApproxTokens, staticRequestApproxTokens } = require(
    path.join(BUILD_DIR, "extraction", "prompt.js"),
  );
  const { downscaleFrame, FRAME_MAX_EDGE_PX } = require(path.join(BUILD_DIR, "extraction", "downscale.js"));
  const { inputTokenCeiling, describeInputTokenCeiling, IMAGE_TOKEN_BUDGET, sessionTokenBudget } =
    require(path.join(BUILD_DIR, "extraction", "config.js"));
  const sharp = require("sharp");

  process.env.CV_EXTRACTION_ENABLED = "true";
  process.env.OPENAI_VISION_MODEL = "gpt-5-nano";
  process.env.OPENAI_VISION_ESCALATION_MODEL = "gpt-5.4-mini";

  const CEILING = inputTokenCeiling();

  const frameUrl = (p) => `https://example.test/${p}`;
  const storage = makeFixtureFetch();
  /** The real downscale, over faked storage. */
  const prepareImage = (url) => downscaleFrame(url, { fetchImpl: storage.fetchImpl });
  /**
   * The queue emit, injected (u30).
   *
   * Injected rather than defaulted because the real emitter writes
   * data/pending-submissions.local.json when Supabase is unconfigured, which is
   * exactly the case here — an un-injected pump would have this suite quietly
   * appending to a developer's real local queue on every run.
   */
  const emitter = (db, impl) => async (sessionId) => {
    db.state.emits.push(sessionId);
    db.state.events.push(`emit:${sessionId}`);
    if (impl) await impl(sessionId);
  };
  const run = (db, vision, opts = {}) =>
    pumpOnce({
      db,
      vision,
      frameUrl,
      prepareImage,
      emitSubmission: emitter(db, opts.emitImpl),
      concurrency: 4,
      ...opts,
      // Injected so the drain stage never reaches the real OpenAI client; the
      // default answers benignly so cases that do not care about synthesis are
      // unaffected, and synthesis-specific cases pass their own scripted client.
      synthesis: opts.synthesis ?? makeSynthesis(() => synthResponse(synthDraft())),
    });

  /* ---------------- Happy path ---------------- */
  console.log("\nhappy path");
  {
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ok(T));
    const result = await run(db, vision);

    check(
      "3 frames claimed, 3 done, 0 failed, 0 remaining",
      result.claimed === 3 && result.done === 3 && result.failed === 0 && result.remaining === 0,
      JSON.stringify(result),
    );
    check("one model call per frame", vision.calls.length === 3, `got ${vision.calls.length}`);
    check("three observations written", db.state.observations.length === 3);
    check(
      "observation records the model and token usage",
      db.state.observations[0].model === "gpt-5-nano" &&
        db.state.observations[0].inputTokens === 1200,
    );
    check(
      "the model's per-frame rationale flows through to the write path",
      db.state.observations.every((o) => o.rationale === RATIONALE),
      JSON.stringify(db.state.observations[0].rationale),
    );
    check(
      "session rolled up and marked review_ready",
      db.state.rollups.length === 1 && db.state.sessionStatus === "review_ready",
      `status=${db.state.sessionStatus} rollups=${db.state.rollups.length}`,
    );
    check(
      "rollup carries lens scores",
      typeof db.state.rollups[0].scores.accessibility === "number",
      JSON.stringify(db.state.rollups[0].scores),
    );
    check(
      "session filed into the review queue exactly once (u30)",
      db.state.emits.length === 1 && db.state.emits[0] === SID,
      JSON.stringify(db.state.emits),
    );
    check(
      "filed BEFORE the review_ready latch (u30)",
      db.state.events.indexOf(`emit:${SID}`) <
        db.state.events.indexOf("status:review_ready"),
      JSON.stringify(db.state.events),
    );
  }

  /* ---------------- Queue emit is the gate on review_ready (u30) ---------------- */
  console.log("\nqueue emit failure leaves the session retryable");
  {
    // review_ready is a one-way latch: drainedSessions only returns `extracting`
    // sessions. If the emit could fail AFTER that write, the walk would be
    // finished, unqueued, and never drained again — invisible to every human.
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ok(T));
    let attempt = 0;
    await run(db, vision, {
      emitImpl: async () => {
        attempt++;
        throw new Error("queue unavailable");
      },
    });

    check(
      "a failed emit does NOT flip the session to review_ready",
      db.state.sessionStatus === "extracting",
      `status=${db.state.sessionStatus}`,
    );
    check("the emit was attempted", attempt === 1, `attempts=${attempt}`);
    check(
      "no review_ready was ever written",
      !db.state.statusWrites.includes("review_ready"),
      JSON.stringify(db.state.statusWrites),
    );

    // The frames are done, so the next pump claims nothing but still drains —
    // which is what makes the retry real rather than theoretical.
    const retry = await run(db, vision);
    check(
      "the next pump re-files it and lands review_ready",
      db.state.sessionStatus === "review_ready" && db.state.emits.length === 2,
      `status=${db.state.sessionStatus} emits=${db.state.emits.length} claimed=${retry.claimed}`,
    );
  }

  /* ---------------- Cost breaker ---------------- */
  console.log("\ncost breaker");
  {
    const db = makeDb({ frameCount: 3 });
    // Far over the per-frame ceiling: a provider billing a full-resolution image
    // for the 512 px one it was sent.
    const vision = makeVision(() => ({
      outcome: "completed",
      text: modelText(T),
      detail: null,
      usage: USAGE(30_000),
    }));
    const result = await run(db, vision, { concurrency: 1 });

    check("no observation is written for an over-budget frame", db.state.observations.length === 0);
    check(
      "the tripping job is failed_overbudget",
      db.jobs.get("frame-0").status === "failed_overbudget",
      db.jobs.get("frame-0").status,
    );
    check(
      "the session is cost_paused",
      db.state.sessionStatus === "cost_paused",
      db.state.sessionStatus,
    );
    check(
      "pause reason is persisted through setSessionStatus",
      (db.state.pauseReasons ?? []).some((r) => /image budget|static request/i.test(r)),
      JSON.stringify(db.state.pauseReasons ?? []),
    );
    check("every frame is reported failed", result.done === 0 && result.failed === 3, JSON.stringify(result));
    check(
      "the breaker stops the session after the first frame, it does not keep paying",
      vision.calls.length === 1,
      `${vision.calls.length} model calls`,
    );
    check(
      "the untouched frames go back to pending, not failed",
      db.jobs.get("frame-1").status === "pending" && db.jobs.get("frame-2").status === "pending",
    );
    check(
      "the breaker message shows what the ceiling is made of, not a bare number",
      /static request/.test(db.jobs.get("frame-0").error) &&
        /image budget/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  /* ---------------- Over-budget with valid JSON ---------------- */
  console.log("\ncost breaker precedence");
  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: modelText(T),
      detail: null,
      usage: USAGE(CEILING + 1),
    }));
    await run(db, vision);
    check(
      "a perfectly valid answer one token over the ceiling is still rejected",
      db.jobs.get("frame-0").status === "failed_overbudget" && db.state.observations.length === 0,
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: modelText(T),
      detail: null,
      usage: USAGE(CEILING),
    }));
    await run(db, vision);
    check(
      "a frame exactly at the ceiling is accepted — the guard is >, not >=",
      db.jobs.get("frame-0").status === "done" && db.state.observations.length === 1,
      db.jobs.get("frame-0").error ?? "",
    );
  }

  /* ---------------- The ceiling itself ---------------- */
  console.log("\nprompt-aware ceiling");
  {
    // The ceiling used to be a flat 2600 while the request's static part is
    // ~4600, so it fired on every correct call — the breaker was measuring our
    // own prompt. Deriving it is what makes editing prompt.ts or schema.ts safe.
    check(
      "the ceiling is derived from the measured request, not hardcoded",
      CEILING === staticRequestApproxTokens() + IMAGE_TOKEN_BUDGET,
      `${CEILING} vs ~${staticRequestApproxTokens()} + ${IMAGE_TOKEN_BUDGET}`,
    );
    check(
      "it clears the whole static request, which a correct call always pays",
      CEILING > staticRequestApproxTokens(),
    );
    check(
      "the strict schema is counted, not just the prompt — it is ~1900 billed tokens",
      staticRequestApproxTokens() > systemPromptApproxTokens() * 1.5,
      `static ~${staticRequestApproxTokens()} vs prompt ~${systemPromptApproxTokens()}`,
    );
    check(
      "an image billed an order of magnitude over its ~470 tokens still trips it",
      staticRequestApproxTokens() + 4700 > CEILING,
      `static + 4700 = ${staticRequestApproxTokens() + 4700} vs ${CEILING}`,
    );
    check(
      "the composition is spelled out for whoever finds the paused session",
      /static request/.test(describeInputTokenCeiling()) &&
        /image budget/.test(describeInputTokenCeiling()),
      describeInputTokenCeiling(),
    );

    process.env.CV_INPUT_TOKEN_CEILING = "999";
    check(
      "CV_INPUT_TOKEN_CEILING overrides it, and says so",
      inputTokenCeiling() === 999 && /override/.test(describeInputTokenCeiling()),
      describeInputTokenCeiling(),
    );
    process.env.CV_INPUT_TOKEN_CEILING = "";
    check("an empty override falls back to the derived ceiling", inputTokenCeiling() === CEILING);
    process.env.CV_INPUT_TOKEN_CEILING = "not-a-number";
    check("a junk override does not disable the breaker", inputTokenCeiling() === CEILING);
    delete process.env.CV_INPUT_TOKEN_CEILING;
  }

  /* ---------------- The frame we actually send ---------------- */
  console.log("\nframe downscale");
  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ok(T));
    await run(db, vision);

    const sent = vision.calls[0].imageUrl;
    check(
      "the model is sent inline JPEG bytes, not the storage URL",
      sent.startsWith("data:image/jpeg;base64,"),
      sent.slice(0, 40),
    );
    check(
      "the storage URL is never what reaches the model",
      !sent.includes("example.test"),
    );

    const meta = await sharp(Buffer.from(sent.split(",")[1], "base64")).metadata();
    check(
      `the image is downscaled to ${FRAME_MAX_EDGE_PX} px on the longest side`,
      Math.max(meta.width, meta.height) === FRAME_MAX_EDGE_PX,
      `${meta.width}x${meta.height} (fixture is 960x666)`,
    );
    check(
      "aspect ratio is preserved — the model sees the street, not a squash",
      Math.abs(meta.width / meta.height - 960 / 666) < 0.01,
      `${(meta.width / meta.height).toFixed(3)}`,
    );

    // ~256 patches at 512 px. This is the bound that holds even when detail:low
    // is ignored, which is the entire point of doing the resize ourselves.
    const patches = Math.ceil(meta.width / 32) * Math.ceil(meta.height / 32);
    check(
      "the bounded image cannot cost more than the image budget, hint or no hint",
      Math.ceil(patches * 2.46) < IMAGE_TOKEN_BUDGET,
      `${patches} patches ~= ${Math.ceil(patches * 2.46)} tokens vs a ${IMAGE_TOKEN_BUDGET} budget`,
    );
  }

  {
    // The escalation call must not send the stronger model back to storage for
    // the full-resolution original: same frame, same bytes, one fetch.
    const db = makeDb({ frameCount: 1 });
    const storage1 = makeFixtureFetch();
    const vision = makeVision((req) =>
      req.model === "gpt-5-nano" ? ok(T, { confidence: 0.2 }) : ok(T, { confidence: 0.95 }),
    );
    await run(db, vision, {
      prepareImage: (url) => downscaleFrame(url, { fetchImpl: storage1.fetchImpl }),
    });
    check(
      "an escalated frame is fetched and shrunk once, not twice",
      vision.calls.length === 2 && storage1.fetches.length === 1,
      `${vision.calls.length} model calls, ${storage1.fetches.length} fetch(es)`,
    );
    check(
      "both models are asked about the same downscaled bytes",
      vision.calls[0].imageUrl === vision.calls[1].imageUrl,
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ok(T));
    await run(db, vision, {
      prepareImage: async () => {
        throw new Error("404 gone");
      },
    });
    check(
      "a frame that cannot be fetched fails the attempt without paying a model",
      vision.calls.length === 0 &&
        db.state.observations.length === 0 &&
        /image_prepare/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  {
    // The live smoke feeds the fixture as a data: URL, so this path has to work
    // without a fetch at all.
    const asDataUrl = `data:image/jpeg;base64,${readFileSync(FIXTURE).toString("base64")}`;
    const out = await downscaleFrame(asDataUrl, {
      fetchImpl: async () => {
        throw new Error("a data: URL must not be fetched");
      },
    });
    const meta = await sharp(Buffer.from(out.split(",")[1], "base64")).metadata();
    check(
      "a data: URL is decoded directly and downscaled the same way",
      Math.max(meta.width, meta.height) === FRAME_MAX_EDGE_PX,
      `${meta.width}x${meta.height}`,
    );
    check(
      "the downscaled frame is a fraction of the original's bytes",
      out.length < asDataUrl.length / 4,
      `${Math.round(out.length / 1024)} KB vs ${Math.round(asDataUrl.length / 1024)} KB`,
    );
  }

  /* ---------------- Escalation ---------------- */
  console.log("\nescalation");
  {
    const db = makeDb({ frameCount: 10 });
    const ESC_RATIONALE = "Stronger model: clearly a two-lane street with an intact gutter on both edges.";
    const vision = makeVision((req) =>
      req.model === "gpt-5-nano"
        ? ok(T, { confidence: 0.2 }) // hedging: below the 0.35 threshold
        : ok(T, { confidence: 0.95, rationale: ESC_RATIONALE }),
    );
    await run(db, vision, { concurrency: 1 });

    const escalated = db.state.observations.filter((o) => o.escalated);
    check(
      "a low-confidence frame escalates to the stronger model",
      escalated.length >= 1 && escalated[0].model === "gpt-5.4-mini",
      `${escalated.length} escalated`,
    );
    check(
      "the escalated row carries the STRONGER model's rationale, not the cheap one's",
      escalated.length >= 1 && escalated[0].rationale === ESC_RATIONALE,
      escalated[0] && JSON.stringify(escalated[0].rationale),
    );
    check(
      "escalation is capped at 10% of session frames",
      escalated.length === 1,
      `${escalated.length} escalated of 10 frames`,
    );
    check(
      "past the cap the cheap model's answer is kept rather than dropped",
      db.state.observations.length === 10,
      `${db.state.observations.length} observations`,
    );
  }

  {
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ok(T, { confidence: 0.95 }));
    await run(db, vision);
    check(
      "a confident frame does not escalate",
      vision.calls.length === 3 && db.state.observations.every((o) => !o.escalated),
    );
  }

  {
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ok(T, { confidence: 0.1, usable: false, reason: "motion_blur" }));
    await run(db, vision);
    check(
      "an unusable frame does not escalate — the truck is really in the way",
      vision.calls.length === 3,
      `${vision.calls.length} calls`,
    );
  }

  /* ---------------- Refusal / incomplete ---------------- */
  console.log("\nrefusal and incomplete");
  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "refusal",
      text: null,
      detail: "I can't help with that.",
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "a refusal is a failed attempt, requeued below the attempts cap",
      db.jobs.get("frame-0").status === "pending" &&
        /refusal/.test(db.jobs.get("frame-0").error),
      `${db.jobs.get("frame-0").status}: ${db.jobs.get("frame-0").error}`,
    );
    check("a refusal writes no observation", db.state.observations.length === 0);
  }

  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "incomplete",
      text: null,
      detail: "max_output_tokens",
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "a truncated response is a failed attempt with the reason recorded",
      db.jobs.get("frame-0").status === "pending" &&
        /incomplete/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: "{not json",
      detail: null,
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "unparsable output fails the attempt rather than throwing",
      db.jobs.get("frame-0").status === "pending" &&
        /json_parse/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    // Schema-valid JSON, semantically out of range: scale_0_4 cannot be 9.
    const bad = JSON.parse(modelText(T));
    bad.items.sidewalk_width.value = 9;
    const vision = makeVision(() => ({
      outcome: "completed",
      text: JSON.stringify(bad),
      detail: null,
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "an out-of-range value is rejected even though strict json_schema 'guaranteed' it",
      db.state.observations.length === 0 && /schema/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    // rationale is required now; a response that drops it is a schema failure,
    // not a silently-stored blank. Strict json_schema should make this
    // unreachable from the real API, but the zod re-validation is what we trust.
    const noRationale = JSON.parse(modelText(T));
    delete noRationale.rationale;
    const vision = makeVision(() => ({
      outcome: "completed",
      text: JSON.stringify(noRationale),
      detail: null,
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "a response missing the rationale is rejected, not stored blank",
      db.state.observations.length === 0 && /schema/.test(db.jobs.get("frame-0").error),
      db.jobs.get("frame-0").error,
    );
  }

  /* ---------------- Attempts cap ---------------- */
  console.log("\nattempts cap");
  {
    // attempts already at 2; this claim makes it 3 = MAX_JOB_ATTEMPTS.
    const db = makeDb({ frameCount: 1, attempts: { 0: 2 } });
    const vision = makeVision(() => ({
      outcome: "refusal",
      text: null,
      detail: "no",
      usage: USAGE(900),
    }));
    await run(db, vision);
    check(
      "the third failed attempt is terminal, not requeued forever",
      db.jobs.get("frame-0").status === "failed",
      db.jobs.get("frame-0").status,
    );
  }

  {
    // Already past the cap: must not spend a model call at all.
    const db = makeDb({ frameCount: 1, attempts: { 0: 5 } });
    const vision = makeVision(() => ok(T));
    await run(db, vision);
    check(
      "a job past the attempts cap is failed without paying a model",
      db.jobs.get("frame-0").status === "failed" && vision.calls.length === 0,
      `${vision.calls.length} calls`,
    );
  }

  /* ---------------- Concurrent pumps ---------------- */
  console.log("\nconcurrent pump safety");
  {
    const db = makeDb({ frameCount: 8 });
    // Every frame now reaches the model as a data URL of the same fixture, so
    // the model call can no longer tell them apart. The fetch can: one per frame
    // processed, carrying the storage path.
    const storage8 = makeFixtureFetch();
    const prepare8 = (url) => downscaleFrame(url, { fetchImpl: storage8.fetchImpl });
    const vision = makeVision(async () => {
      // Yield, so two pumps genuinely interleave rather than running in turn.
      await new Promise((r) => setTimeout(r, 5));
      return ok(T);
    });

    const [a, b] = await Promise.all([
      run(db, vision, { prepareImage: prepare8 }),
      run(db, vision, { prepareImage: prepare8 }),
    ]);

    const unique = new Set(storage8.fetches);
    check(
      "two concurrent pumps never process the same frame twice",
      storage8.fetches.length === unique.size &&
        unique.size === 8 &&
        vision.calls.length === 8,
      `${vision.calls.length} calls over ${unique.size} distinct frames`,
    );
    check(
      "between them they claim every job exactly once",
      a.claimed + b.claimed === 8,
      `${a.claimed} + ${b.claimed}`,
    );
    check("all 8 frames end done", db.state.observations.length === 8);
    check(
      "the session is rolled up exactly once",
      db.state.statusWrites.filter((s) => s === "review_ready").length === 1,
      JSON.stringify(db.state.statusWrites),
    );
  }

  /* ---------------- Kill switch ---------------- */
  console.log("\nkill switch");
  {
    process.env.CV_EXTRACTION_ENABLED = "false";
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ok(T));
    const result = await run(db, vision);
    check(
      "the switch off means no claim and no spend, with work left waiting",
      vision.calls.length === 0 && result.claimed === 0 && result.remaining === 3,
      JSON.stringify(result),
    );

    process.env.CV_EXTRACTION_ENABLED = "";
    const r2 = await run(makeDb({ frameCount: 1 }), makeVision(() => ok(T)));
    check("an unset switch fails closed", r2.claimed === 0);
    process.env.CV_EXTRACTION_ENABLED = "true";
  }

  /* ---------------- Session budget ---------------- */
  console.log("\nper-session budget");
  {
    // Pinned rather than derived, so this case keeps testing the session guard
    // instead of drifting with the prompt: the numbers below only have to sit
    // under the per-frame ceiling, and the allowance only has to sit under them.
    process.env.CV_SESSION_TOKENS_PER_FRAME = "1500";
    check(
      "CV_SESSION_TOKENS_PER_FRAME sets the per-frame allowance",
      sessionTokenBudget(2) === 3000,
      `${sessionTokenBudget(2)}`,
    );
    check(
      "unset, the allowance is derived from the ceiling plus the escalation cap",
      (() => {
        delete process.env.CV_SESSION_TOKENS_PER_FRAME;
        const derived = sessionTokenBudget(1);
        process.env.CV_SESSION_TOKENS_PER_FRAME = "1500";
        return derived === Math.ceil(CEILING * 1.1) && derived > CEILING;
      })(),
    );
  }

  {
    const db = makeDb({ frameCount: 2 });
    // Budget is frames x 1500 = 3000. Each frame bills 2500 — under the
    // per-frame ceiling, so ONLY the session cap can catch this.
    const vision = makeVision(() => ({
      outcome: "completed",
      text: modelText(T),
      detail: null,
      usage: USAGE(2500),
    }));
    await run(db, vision, { concurrency: 1 });
    check(
      "a session under the per-frame ceiling still gets caught by its own budget",
      db.state.sessionStatus === "cost_paused",
      `status=${db.state.sessionStatus} spent=${db.state.observations.reduce((s, o) => s + o.inputTokens, 0)}/3000`,
    );
    check(
      "the overrun is caught on the LAST frame too, not silently passed as review_ready",
      !db.state.statusWrites.includes("review_ready"),
      JSON.stringify(db.state.statusWrites),
    );
    check(
      "frames already paid for keep their data — the spend is sunk either way",
      db.state.observations.length === 2,
      `${db.state.observations.length} observations`,
    );
  }

  {
    // The cap must not fire on an ordinary session: 3 frames, budget 4500,
    // ~1300 each is the expected steady state.
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: modelText(T),
      detail: null,
      usage: USAGE(1300),
    }));
    await run(db, vision, { concurrency: 1 });
    check(
      "a normal session finishes without tripping the budget",
      db.state.sessionStatus === "review_ready" && db.state.observations.length === 3,
      `status=${db.state.sessionStatus}`,
    );
    delete process.env.CV_SESSION_TOKENS_PER_FRAME;
  }

  /* ---------------- The request we actually send ---------------- */
  console.log("\nrequest shape and prompt caching");
  {
    const body = buildRequestBody({ model: "gpt-5-nano", imageUrl: "https://x.test/f.jpg" });
    const image = body.input[0].content.find((c) => c.type === "input_image");
    check(
      "detail:low still rides along as belt-and-braces, even though it is ignored",
      image.detail === "low",
    );
    check(
      "the image the caller prepared goes through verbatim",
      image.image_url === "https://x.test/f.jpg",
    );
    check(
      "the cacheable prefix rides in instructions, not the per-frame turn",
      body.instructions === SYSTEM_PROMPT,
    );
    check("structured output is strict", body.text.format.strict === true);
    check(
      "the schema demands exactly the 15 rubric items",
      body.text.format.schema.properties.items.required.length === 15 &&
        T.RUBRIC_ITEM_KEYS.every((k) => body.text.format.schema.properties.items.required.includes(k)),
    );
    check(
      "the schema requires a per-frame rationale string alongside the items",
      body.text.format.schema.required.includes("rationale") &&
        body.text.format.schema.properties.rationale.type === "string",
      JSON.stringify(body.text.format.schema.required),
    );

    const a = buildRequestBody({ model: "m", imageUrl: "https://x.test/1.jpg" });
    const b = buildRequestBody({ model: "m", imageUrl: "https://x.test/2.jpg" });
    check(
      "the prefix is byte-identical across frames, or caching never engages",
      a.instructions === b.instructions,
    );
    check(
      "the prefix clears the 1024-token floor prompt caching needs",
      systemPromptApproxTokens() > 1024,
      `~${systemPromptApproxTokens()} tokens`,
    );
  }

  /* ---------------- Payload sorting ---------------- */
  console.log("\nresponse sorting");
  {
    const refusal = parseVisionPayload({
      status: "completed",
      output: [{ content: [{ type: "refusal", refusal: "no" }] }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    check(
      "a refusal is recognised as a refusal, not a parse failure",
      refusal.outcome === "refusal" && refusal.usage.inputTokens === 10,
    );
    check(
      "a refusal still reports its usage — it was billed",
      refusal.usage.inputTokens === 10,
    );

    const incomplete = parseVisionPayload({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 5 },
    });
    check("truncation is distinguished from refusal", incomplete.outcome === "incomplete");

    const good = parseVisionPayload({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: '{"a":1}' }] }],
      usage: { input_tokens: 7, output_tokens: 1, input_tokens_details: { cached_tokens: 4 } },
    });
    check(
      "a good answer yields its text and cached-token count",
      good.outcome === "completed" && good.text === '{"a":1}' && good.usage.cachedTokens === 4,
    );
  }

  /* ---------------- frameQuality.reason null vs optional ---------------- */
  console.log("\nframeQuality reason (wire null vs schema optional)");
  {
    // strict json_schema cannot omit a key, so "nothing was wrong" arrives as
    // reason:null — but captureFrameQualitySchema types reason as an OPTIONAL
    // string, and zod .optional() admits undefined, not null. Without the
    // normalization in extract.ts, every GOOD frame fails on the one field that
    // says nothing was wrong. This is the common case, so it is a regression
    // guard, not an edge case.
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: JSON.stringify({
        schemaVersion: "cv-v1",
        items: items(T),
        frameQuality: { usable: true, reason: null },
        rationale: RATIONALE,
      }),
      detail: null,
      usage: USAGE(1000),
    }));
    await run(db, vision);
    check(
      "a usable frame reporting reason:null validates",
      db.state.observations.length === 1 && db.jobs.get("frame-0").status === "done",
      db.jobs.get("frame-0").error ?? "",
    );
  }

  {
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ({
      outcome: "completed",
      text: JSON.stringify({
        schemaVersion: "cv-v1",
        items: items(T, { value: null, confidence: 0.1 }),
        frameQuality: { usable: false, reason: "motion_blur" },
        rationale: "Whole frame is motion-blurred; the street cannot be read at all.",
      }),
      detail: null,
      usage: USAGE(1000),
    }));
    await run(db, vision);
    check(
      "an unusable frame keeps its reason and is recorded, not dropped",
      db.state.observations.length === 1 &&
        db.state.observations[0].usable === false &&
        db.jobs.get("frame-0").status === "done",
    );
  }

  /* ---------------- Escalation predicate ---------------- */
  console.log("\nescalation predicate");
  {
    const parse = (opts) => JSON.parse(modelText(T, opts));
    const withModel = (o) => ({ ...o, model: "m", schemaVersion: "cv-v1" });

    check(
      "a hedged item on a usable frame escalates",
      shouldEscalate(withModel(parse({ confidence: 0.2 }))) === true,
    );
    check(
      "a confident frame does not",
      shouldEscalate(withModel(parse({ confidence: 0.9 }))) === false,
    );

    const honestNull = withModel(parse({ confidence: 0.1, value: null }));
    check(
      "a low-confidence NULL does not escalate — that is an honest 'cannot see it'",
      shouldEscalate(honestNull) === false,
    );
  }

  /* ---------------- Retry policy ---------------- */
  console.log("\nretry policy");
  {
    const { createOpenAiVisionClient } = require(path.join(BUILD_DIR, "extraction", "client.js"));
    const mkResponse = (status, body) => ({
      ok: false,
      status,
      statusText: "err",
      async text() {
        return body;
      },
      async json() {
        return JSON.parse(body);
      },
    });

    // A real 429 is worth backing off from.
    let calls = 0;
    const flaky = createOpenAiVisionClient({
      apiKey: "sk-test",
      sleepImpl: async () => {},
      rand: () => 0,
      fetchImpl: async () => {
        calls++;
        return calls < 3
          ? mkResponse(429, '{"error":{"message":"Rate limit reached"}}')
          : {
              ok: true,
              status: 200,
              async json() {
                return {
                  status: "completed",
                  output: [{ content: [{ type: "output_text", text: modelText(T) }] }],
                  usage: { input_tokens: 1200, output_tokens: 100 },
                };
              },
            };
      },
    });
    const out = await flaky.extract({ model: "m", imageUrl: "https://x.test/f.jpg" });
    check(
      "an ordinary 429 is retried and can succeed",
      out.outcome === "completed" && calls === 3,
      `${calls} attempts`,
    );

    // insufficient_quota is a 429 that can never succeed: the account is out of
    // money. Retrying it three times just arrives at the same answer slower and
    // buries "check your billing" under a generic message. Found by the live
    // smoke, which burned three attempts on exactly this.
    let quotaCalls = 0;
    const broke = createOpenAiVisionClient({
      apiKey: "sk-test",
      sleepImpl: async () => {},
      rand: () => 0,
      fetchImpl: async () => {
        quotaCalls++;
        return mkResponse(429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}');
      },
    });
    let threw = null;
    try {
      await broke.extract({ model: "m", imageUrl: "https://x.test/f.jpg" });
    } catch (err) {
      threw = err;
    }
    check(
      "insufficient_quota fails fast instead of backing off three times",
      quotaCalls === 1 && threw !== null && /insufficient_quota/.test(threw.message),
      `${quotaCalls} attempt(s)`,
    );

    let badCalls = 0;
    const bad = createOpenAiVisionClient({
      apiKey: "sk-test",
      sleepImpl: async () => {},
      fetchImpl: async () => {
        badCalls++;
        return mkResponse(400, '{"error":{"message":"Unsupported parameter"}}');
      },
    });
    let bad400 = null;
    try {
      await bad.extract({ model: "m", imageUrl: "https://x.test/f.jpg" });
    } catch (err) {
      bad400 = err;
    }
    check(
      "a 400 is our bug and is not retried",
      badCalls === 1 && bad400 !== null,
      `${badCalls} attempt(s)`,
    );
  }

  /* ---------------- Request params the models accept ---------------- */
  console.log("\nrequest parameters");
  {
    const body = buildRequestBody({ model: "gpt-5-nano", imageUrl: "https://x.test/f.jpg" });
    check(
      "no temperature — gpt-5 reasoning models 400 the whole request on it",
      !("temperature" in body),
      JSON.stringify(Object.keys(body)),
    );
  }

  /* ---------------- Transport ---------------- */
  console.log("\ntransport failure");
  {
    const throwing = {
      async extract() {
        throw new Error("ECONNRESET");
      },
    };
    const out = await extractFrame(throwing, "https://x.test/f.jpg", "m", {
      prepareImage: async (u) => u,
    });
    check(
      "a transport failure is a failed attempt reporting no spend",
      out.kind === "failed" && out.usage.inputTokens === 0 && /transport/.test(out.reason),
      out.reason,
    );
  }

  /* ---------------- Synthesis: the drain stage (0022) ---------------- */
  console.log("\nsynthesis drain stage");
  {
    process.env.CV_EXTRACTION_ENABLED = "true";
    // The model proposes a wild accessibility drop and a modest shade drop; the
    // engine clamps, applies, and recomputes overall — all on the drain.
    const db = makeDb({ frameCount: 3 });
    const vision = makeVision(() => ok(T));
    const synth = makeSynthesis(() =>
      synthResponse(
        synthDraft({
          accessibility: { delta: 999, reason: "sidewalk disappears for 200 m" },
          shade: { delta: -5, reason: "canopy thins out halfway" },
        }),
        { inputTokens: 512, outputTokens: 210, cachedTokens: 0 },
      ),
    );
    await run(db, vision, { synthesis: synth, concurrency: 1 });

    check(
      "the session still rolled up and reached review_ready",
      db.state.rollups.length === 1 && db.state.sessionStatus === "review_ready",
      `status=${db.state.sessionStatus}`,
    );
    check("synthesis ran once and persisted an assessment", db.state.assessments.length === 1);

    const a = db.state.assessments[0];
    const baseAcc = db.state.rollups[0].scores.accessibility;
    check(
      "the wild delta is clamped to the +/-20 bound",
      a.assessment.adjustments.accessibility.delta === 20,
      `${a.assessment.adjustments.accessibility.delta}`,
    );
    check(
      "adjustedScores = clamp(baseline + bounded delta)",
      a.assessment.adjustedScores.accessibility ===
        Math.round(Math.max(0, Math.min(100, baseAcc + 20)) * 100) / 100,
      `${a.assessment.adjustedScores.accessibility} from base ${baseAcc}`,
    );
    const expectedOverall = SCORING.renormalizedOverall(
      a.assessment.adjustedScores.accessibility,
      a.assessment.adjustedScores.drainage,
      a.assessment.adjustedScores.shade,
    );
    check(
      "overall is recomputed from the adjusted lenses, not copied from the model",
      Math.abs(a.assessment.adjustedScores.overall - Math.round(expectedOverall * 100) / 100) < 0.01,
      `${a.assessment.adjustedScores.overall}`,
    );
    check(
      "the synthesis spend is recorded on the write for the session ledger",
      a.inputTokens === 512 && a.outputTokens === 210,
      JSON.stringify({ i: a.inputTokens, o: a.outputTokens }),
    );
  }

  {
    // A lens whose baseline is null stays null: the model cannot invent a bike
    // score for a street where no frame could assess cycling.
    const db = makeDb({ frameCount: 2 });
    const bikeNull = () => {
      const it = items(T);
      for (const k of ["bike_lane_present", "bike_separation", "bike_surface"]) {
        it[k] = { value: null, confidence: 0.2 };
      }
      return JSON.stringify({
        schemaVersion: "cv-v1",
        items: it,
        frameQuality: { usable: true, reason: null },
        rationale: RATIONALE,
      });
    };
    const vision = makeVision(() => ({ outcome: "completed", text: bikeNull(), detail: null, usage: USAGE(1200) }));
    const synth = makeSynthesis(() =>
      synthResponse(synthDraft({ bike: { delta: 15, reason: "great protected lane" } })),
    );
    await run(db, vision, { synthesis: synth, concurrency: 1 });

    const a = db.state.assessments[0];
    check(
      "baseline bike is null when no frame could assess it",
      db.state.rollups[0].scores.bike === null,
      JSON.stringify(db.state.rollups[0].scores),
    );
    check("synthesis cannot invent a score for a null-baseline lens", a.assessment.adjustedScores.bike === null);
    check("and no bike adjustment is recorded", a.assessment.adjustments.bike === undefined);
  }

  {
    // A synthesis failure NEVER blocks the drain: the assessment stays null and
    // the walk still reaches a reviewer, honestly labelled "no assessment".
    const db = makeDb({ frameCount: 2 });
    const vision = makeVision(() => ok(T));
    const synth = makeSynthesis(() => ({ outcome: "refusal", text: null, detail: "no", usage: { inputTokens: 5, outputTokens: 0, cachedTokens: 0 } }));
    await run(db, vision, { synthesis: synth, concurrency: 1 });
    check("a synthesis refusal writes no assessment", db.state.assessments.length === 0);
    check(
      "the session still rolls up and reaches review_ready",
      db.state.rollups.length === 1 && db.state.sessionStatus === "review_ready",
    );
    check("synthesis was attempted", synth.calls.length === 1);
  }

  {
    // A synthesis client that throws does not stop the session either.
    const db = makeDb({ frameCount: 1 });
    const vision = makeVision(() => ok(T));
    const throwing = {
      async synthesize() {
        throw new Error("boom");
      },
    };
    await run(db, vision, { synthesis: throwing });
    check(
      "a synthesis throw leaves the session review_ready with no assessment",
      db.state.sessionStatus === "review_ready" && db.state.assessments.length === 0,
      `status=${db.state.sessionStatus}`,
    );
  }

  {
    // Kill switch: with extraction disabled the drain stage must not synthesise —
    // no spend when the switch is off. rollupSession is driven directly because a
    // disabled pump returns before it ever rolls up.
    process.env.CV_EXTRACTION_ENABLED = "false";
    const db = makeDb({ frameCount: 1 });
    await db.completeJob({
      frameId: "frame-0",
      model: "gpt-5-nano",
      items: items(T),
      usable: true,
      confidence: 0.9,
      inputTokens: 1000,
      outputTokens: 100,
      escalated: false,
      rationale: RATIONALE,
    });
    const synth = makeSynthesis(() => synthResponse(synthDraft()));
    await rollupSession(db, SID, emitter(db), synth);
    check("synthesis does not run while the kill switch is off", synth.calls.length === 0, `${synth.calls.length} calls`);
    check(
      "the rollup still lands and the session reaches review_ready",
      db.state.rollups.length === 1 && db.state.sessionStatus === "review_ready",
    );
    process.env.CV_EXTRACTION_ENABLED = "true";
  }

  /* -------------------------------------------------------------- */
  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — extraction worker");
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
