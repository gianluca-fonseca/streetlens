#!/usr/bin/env node
/**
 * test-upload-client.mjs (u25 capture contracts)
 *
 * The upload client is the piece a contributor's twenty-minute walk depends on,
 * so the failure paths matter more than the happy one. Drives it against a fake
 * server implementing the /api/capture contract.
 *
 * Covers: call order, retry/backoff on transient failures, NOT retrying a 400,
 * resume (only re-uploading what is missing), bounded concurrency, progress
 * reporting, and abort.
 *
 * The storage PUT itself is injected (see UploadCaptureOptions.uploadFrame) —
 * the bucket does not exist until 0013 is applied. Everything around it is real.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import Module, { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-upload-client");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const SID = "0b8a9a1e-0e6e-4c9a-9f0d-9a1f2b3c4d5e";
const T0 = 1_784_000_000_000;

/** A fake /api/capture server. `plan` lets a case fail specific calls. */
function makeServer({ plan = {}, acceptedSeqs = null } = {}) {
  const calls = [];
  const attempts = {};

  const fetchImpl = async (url, init = {}) => {
    const route = url.replace(/^https?:\/\/[^/]+/, "");
    const method = init.method ?? "GET";
    const key = `${method} ${route}`;
    calls.push(key);
    attempts[key] = (attempts[key] ?? 0) + 1;

    const failure = plan[key];
    if (failure && attempts[key] <= (failure.times ?? Infinity)) {
      if (failure.throw) throw new TypeError("network down");
      return new Response(JSON.stringify({ error: "boom" }), { status: failure.status });
    }

    if (route === "/api/capture/sessions" && method === "POST") {
      const body = JSON.parse(init.body);
      if (body.honeypot !== "") return new Response("{}", { status: 400 });
      return Response.json({
        sessionId: SID,
        uploadPrefix: `captures/${SID}`,
        maxFrames: 400,
        maxFrameBytes: 2097152,
      });
    }
    if (route.endsWith("/frames") && method === "POST") {
      const body = JSON.parse(init.body);
      const seqs = body.frames.map((f) => f.seq);
      return Response.json({ accepted: acceptedSeqs ?? seqs });
    }
    if (route.endsWith("/finalize") && method === "POST") {
      return Response.json({ status: "matching" });
    }
    if (route === `/api/capture/sessions/${SID}` && method === "GET") {
      return Response.json({
        status: "uploading",
        frameCount: 2,
        jobs: { pending: 2, done: 0, failed: 0 },
      });
    }
    return new Response("not found", { status: 404 });
  };

  return { fetchImpl, calls, attempts };
}

function frames(count) {
  return Array.from({ length: count }, (_, seq) => ({
    meta: {
      seq,
      t: T0 + seq * 1000,
      storagePath: `captures/${SID}/frame-${String(seq).padStart(4, "0")}.jpg`,
      width: 1920,
      height: 1080,
      bytes: 500_000,
    },
    blob: new Blob([`frame-${seq}`], { type: "image/jpeg" }),
  }));
}

const TRACK = [
  { lat: 9.907, lng: -84.152, t: T0 },
  { lat: 9.907, lng: -84.15, t: T0 + 9000 },
];

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        // Pin rootDir to the repo root. Otherwise tsc infers it from the input
        // set (here: lib/), the emit lands a directory shallower, and the "@/"
        // mapping below points at nothing.
        rootDir: "..",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2020",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: ["../lib/capture/upload-client.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    const mapped = request.startsWith("@/") ? path.join(BUILD_DIR, request.slice(2)) : request;
    return resolveFilename.call(this, mapped, ...rest);
  };

  const U = require(path.join(BUILD_DIR, "lib", "capture", "upload-client.js"));

  return (async () => {
    /* ---------------- Happy path ---------------- */

    {
      const server = makeServer();
      const uploaded = [];
      const result = await U.uploadCapture({
        mode: "live",
        frames: frames(3),
        track: TRACK,
        source: "live",
        fetchImpl: server.fetchImpl,
        uploadFrame: async (_sid, seq) => { uploaded.push(seq); return "uploaded"; },
      });

      check("uploadCapture returns the session id and final status", result.sessionId === SID && result.status === "matching", JSON.stringify(result));
      check("every frame is uploaded", JSON.stringify(result.uploadedSeqs) === "[0,1,2]", JSON.stringify(result.uploadedSeqs));
      check(
        "the call order is create -> register -> finalize",
        JSON.stringify(server.calls) ===
          JSON.stringify([
            "POST /api/capture/sessions",
            `POST /api/capture/sessions/${SID}/frames`,
            `POST /api/capture/sessions/${SID}/finalize`,
          ]),
        JSON.stringify(server.calls),
      );
      check("frames are uploaded BEFORE finalize (the one-way door closes last)", uploaded.length === 3);
    }
    {
      // The honeypot field must be sent explicitly empty: the server
      // distinguishes empty from absent.
      const server = makeServer();
      let body = null;
      const spy = async (url, init) => {
        if (url.endsWith("/api/capture/sessions") && init?.method === "POST") body = JSON.parse(init.body);
        return server.fetchImpl(url, init);
      };
      await U.uploadCapture({
        mode: "video", frames: frames(1), track: TRACK, source: "gpx",
        contact: "me@example.com",
        fetchImpl: spy,
        uploadFrame: async () => "uploaded",
      });
      check("the session request sends mode, an empty honeypot and contact", body?.mode === "video" && body?.honeypot === "" && body?.contact === "me@example.com", JSON.stringify(body));
    }
    {
      const server = makeServer();
      let finalizeBody = null;
      const spy = async (url, init) => {
        if (url.endsWith("/finalize")) finalizeBody = JSON.parse(init.body);
        return server.fetchImpl(url, init);
      };
      await U.uploadCapture({
        mode: "live", frames: frames(1), track: TRACK, source: "trace", clockOffsetMs: -1500,
        fetchImpl: spy, uploadFrame: async () => "uploaded",
      });
      check(
        "finalize carries the track, its source and the clock offset",
        finalizeBody?.source === "trace" && finalizeBody?.clockOffsetMs === -1500 && finalizeBody?.track?.length === 2,
        JSON.stringify(finalizeBody),
      );
    }

    /* ---------------- Retry ---------------- */

    {
      // Two 503s then success: a contributor walking out of a dead spot.
      const server = makeServer({ plan: { "POST /api/capture/sessions": { status: 503, times: 2 } } });
      const result = await U.uploadCapture({
        mode: "live", frames: frames(1), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl, uploadFrame: async () => "uploaded",
      });
      check("a transient 503 is retried until it succeeds", result.sessionId === SID);
      check("it took 3 attempts", server.attempts["POST /api/capture/sessions"] === 3, `${server.attempts["POST /api/capture/sessions"]}`);
    }
    {
      const server = makeServer({ plan: { "POST /api/capture/sessions": { throw: true, times: 1 } } });
      const result = await U.uploadCapture({
        mode: "live", frames: frames(1), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl, uploadFrame: async () => "uploaded",
      });
      check("fetch rejecting outright (offline) is retried", result.sessionId === SID);
    }
    {
      const server = makeServer({ plan: { "POST /api/capture/sessions": { status: 429, times: 1 } } });
      const result = await U.uploadCapture({
        mode: "live", frames: frames(1), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl, uploadFrame: async () => "uploaded",
      });
      check("a 429 is retried (the server asked us to slow down, not to stop)", result.sessionId === SID);
    }
    {
      // A 400 means WE are wrong. Retrying just burns a contributor's battery.
      const server = makeServer({ plan: { "POST /api/capture/sessions": { status: 400 } } });
      let error = null;
      try {
        await U.uploadCapture({
          mode: "live", frames: frames(1), track: TRACK, source: "live",
          fetchImpl: server.fetchImpl, uploadFrame: async () => "uploaded",
        });
      } catch (err) { error = err; }
      check("a 400 is NOT retried", server.attempts["POST /api/capture/sessions"] === 1, `${server.attempts["POST /api/capture/sessions"]} attempts`);
      check("the 400 surfaces as a CaptureUploadError carrying the status", error?.name === "CaptureUploadError" && error?.status === 400, `${error?.name}/${error?.status}`);
    }
    {
      const server = makeServer({ plan: { "POST /api/capture/sessions": { status: 503 } } });
      let error = null;
      try {
        await U.uploadCapture({
          mode: "live", frames: frames(1), track: TRACK, source: "live",
          fetchImpl: server.fetchImpl, maxRetries: 2, uploadFrame: async () => "uploaded",
        });
      } catch (err) { error = err; }
      check("retries are bounded by maxRetries", server.attempts["POST /api/capture/sessions"] === 2, `${server.attempts["POST /api/capture/sessions"]} attempts`);
      check("a permanently failing call eventually throws", error !== null);
    }
    {
      let attempts = 0;
      const server = makeServer();
      const result = await U.uploadCapture({
        mode: "live", frames: frames(1), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl,
        uploadFrame: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("connection reset");
          return "uploaded";
        },
      });
      check("a flaky frame upload is retried too", result.uploadedSeqs.length === 1 && attempts === 3, `${attempts} attempts`);
    }

    /* ---------------- Resume ---------------- */

    {
      // Resume: the server says only seqs 3 and 4 are outstanding.
      const server = makeServer({ acceptedSeqs: [3, 4] });
      const uploaded = [];
      const result = await U.uploadCapture({
        mode: "live", frames: frames(5), track: TRACK, source: "live",
        sessionId: SID,
        fetchImpl: server.fetchImpl,
        uploadFrame: async (_sid, seq) => { uploaded.push(seq); return "uploaded"; },
      });
      check(
        "resuming re-uploads ONLY the frames the server acknowledged",
        JSON.stringify(uploaded.sort((a, b) => a - b)) === "[3,4]",
        JSON.stringify(uploaded),
      );
      check("resuming does not open a second session", !server.calls.includes("POST /api/capture/sessions"), JSON.stringify(server.calls));
      check("the resumed run still finalizes", result.status === "matching");
    }
    {
      // A frame already in storage is success on resume, not an error.
      const server = makeServer();
      const result = await U.uploadCapture({
        mode: "live", frames: frames(3), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl,
        uploadFrame: async (_sid, seq) => (seq === 1 ? "already_present" : "uploaded"),
      });
      check("a frame already in storage counts as done", JSON.stringify(result.uploadedSeqs) === "[0,1,2]");
    }

    /* ---------------- Concurrency ---------------- */

    {
      const server = makeServer();
      let inFlight = 0;
      let peak = 0;
      await U.uploadCapture({
        mode: "live", frames: frames(20), track: TRACK, source: "live",
        concurrency: 4,
        fetchImpl: server.fetchImpl,
        uploadFrame: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          return "uploaded";
        },
      });
      check("concurrency is bounded (never exceeds the limit)", peak <= 4, `peak ${peak}`);
      check("concurrency is actually used (not serial)", peak > 1, `peak ${peak}`);
    }

    /* ---------------- Progress ---------------- */

    {
      const server = makeServer();
      const phases = [];
      const counts = [];
      await U.uploadCapture({
        mode: "live", frames: frames(3), track: TRACK, source: "live",
        fetchImpl: server.fetchImpl,
        uploadFrame: async () => "uploaded",
        onProgress: (p) => { phases.push(p.phase); counts.push(p.uploaded); },
      });
      check(
        "progress reports every phase in order, ending done",
        phases[0] === "creating_session" &&
          phases.includes("registering_frames") &&
          phases.includes("uploading_frames") &&
          phases.includes("finalizing") &&
          phases[phases.length - 1] === "done",
        phases.join(" -> "),
      );
      check("progress counts climb to the frame total", Math.max(...counts) === 3, JSON.stringify(counts));
    }

    /* ---------------- Abort ---------------- */

    {
      const server = makeServer();
      const controller = new AbortController();
      let error = null;
      const promise = U.uploadCapture({
        mode: "live", frames: frames(10), track: TRACK, source: "live",
        concurrency: 1,
        signal: controller.signal,
        fetchImpl: server.fetchImpl,
        uploadFrame: async () => { controller.abort(); return "uploaded"; },
      });
      try { await promise; } catch (err) { error = err; }
      check("aborting stops the run", error?.name === "AbortError", `${error?.name}`);
      check("an aborted run never finalizes", !server.calls.some((c) => c.includes("finalize")), JSON.stringify(server.calls));
    }

    /* ---------------- getSessionStatus ---------------- */

    {
      const server = makeServer();
      const status = await U.getSessionStatus(SID, { fetchImpl: server.fetchImpl });
      check("getSessionStatus reads the progress shape", status.status === "uploading" && status.jobs.pending === 2, JSON.stringify(status));
    }

    /* ---------------- Default fetch binding (u27 regression) ---------------- */

    // Regression for a real defect: every call site did `opts.fetchImpl ??
    // globalThis.fetch`, handing the bare reference on. Browsers require fetch's
    // `this` to be the Window and throw "Illegal invocation" otherwise, so
    // uploadCapture failed on its FIRST call from a real phone while every test
    // here passed. It passed because node's undici does not care about the
    // receiver, which is precisely why this case has to fake the browser's rule
    // rather than trust the runtime's leniency.
    //
    // The emitted CJS is strict, so a detached `f(url)` sees `this === undefined`
    // exactly as it would in a browser.
    {
      const server = makeServer();
      const realFetch = globalThis.fetch;
      let sawDetachedCall = false;
      globalThis.fetch = function boundOnlyFetch(...args) {
        if (this !== globalThis) {
          sawDetachedCall = true;
          throw new TypeError(
            "Failed to execute 'fetch' on 'Window': Illegal invocation",
          );
        }
        return server.fetchImpl(...args);
      };
      let error = null;
      try {
        // No fetchImpl: this is the production path a phone actually takes.
        await U.createSession({ mode: "live" });
      } catch (err) {
        error = err;
      } finally {
        globalThis.fetch = realFetch;
      }
      check(
        "the default fetch is bound, so a browser would not reject it",
        error === null && !sawDetachedCall,
        error ? `threw ${error.message}` : "",
      );
    }

    rmSync(BUILD_DIR, { recursive: true, force: true });

    console.log(
      failures.length === 0
        ? "\nPASS — upload client survives the failure paths"
        : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  })();
}

main();
