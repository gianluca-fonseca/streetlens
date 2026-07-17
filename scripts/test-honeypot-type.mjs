#!/usr/bin/env node
/**
 * test-honeypot-type.mjs (u25 honeypot type-coercion fix)
 *
 * The bug: app/api/submissions/route.ts coerced ANY non-`update_segment` type
 * to `add_segment` when the honeypot tripped. With two types that was merely
 * sloppy; with cv_capture (0014) it actively mislabels — a honeypotted capture
 * would have been filed as a segment proposal it had nothing to do with.
 *
 * The fix preserves the submitted type when it is one we recognize, and files
 * anything else as `unknown` (a bot can post any string, and `submissions.type`
 * has a CHECK constraint, so persisting it verbatim would turn a clean 400 into
 * a 500).
 *
 * This drives the REAL route handler with a stubbed sink, so it fails if the
 * coercion ever comes back. It also locks the two properties that must NOT
 * change: the honeypot still rejects with 400, and a clean submission of an
 * existing type still behaves exactly as before.
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
const BUILD_DIR = path.join(ROOT, ".test-build-honeypot");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const VALID_ADD = {
  name: "Calle Test",
  highway: "residential",
  coordinates: [[-84.152, 9.907], [-84.15, 9.907]],
};

function request(body) {
  return new Request("http://localhost/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });

  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: ["../app/api/submissions/route.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  // tsc type-checks the "@/" alias but emits it verbatim, so CJS cannot resolve
  // it at runtime. Map it onto the build output for the duration of this test.
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    const mapped = request.startsWith("@/")
      ? path.join(BUILD_DIR, request.slice(2))
      : request;
    return resolveFilename.call(this, mapped, ...rest);
  };

  // Intercept the sink so nothing is written and we can read what the route
  // decided to persist. This is the whole point of the test: the bug was
  // invisible in the response and only showed up in the persisted row.
  const persisted = [];
  const sinkPath = require.resolve(path.join(BUILD_DIR, "lib", "submissions-sink.js"));
  require(sinkPath);
  require.cache[sinkPath].exports.persistSubmission = async (record) => {
    persisted.push(record);
    return { sink: "local", id: `test-${persisted.length}` };
  };

  // Rate limiting is per-IP and this test fires many requests from one IP;
  // reset between cases so a 429 never masquerades as the behaviour under test.
  const rlPath = require.resolve(path.join(BUILD_DIR, "lib", "rate-limit.js"));
  const RL = require(rlPath);

  const route = require(path.join(BUILD_DIR, "app", "api", "submissions", "route.js"));

  async function post(body) {
    RL.resetRateLimits();
    persisted.length = 0;
    const response = await route.POST(request(body));
    return { response, row: persisted[0] };
  }

  return (async () => {
    /* ---------------- The bug ---------------- */

    {
      const { response, row } = await post({
        type: "cv_capture",
        payload: { session_id: "0b8a9a1e-0e6e-4c9a-9f0d-9a1f2b3c4d5e" },
        honeypot: "i am a bot",
      });
      check(
        "a honeypotted cv_capture is filed as cv_capture, NOT add_segment (the bug)",
        row?.type === "cv_capture",
        `got type=${row?.type}`,
      );
      check("it is still rejected with 400", response.status === 400);
      check("it is still recorded as rejected + honeypot_tripped", row?.status === "rejected" && row?.honeypot_tripped === true);
    }

    /* ---------------- Types that already worked ---------------- */

    {
      const { row } = await post({ type: "update_segment", payload: {}, honeypot: "bot" });
      check("a honeypotted update_segment is still update_segment", row?.type === "update_segment", `got ${row?.type}`);
    }
    {
      const { row } = await post({ type: "add_segment", payload: {}, honeypot: "bot" });
      check("a honeypotted add_segment is still add_segment", row?.type === "add_segment", `got ${row?.type}`);
    }

    /* ---------------- Unrecognized types ---------------- */

    {
      const { response, row } = await post({ type: "wat", payload: {}, honeypot: "bot" });
      check(
        "an unrecognized type is filed as `unknown`, not mislabelled add_segment",
        row?.type === "unknown",
        `got ${row?.type}`,
      );
      check(
        "the raw submitted type is kept in the payload for forensics",
        row?.payload?.submitted_type === "wat",
        JSON.stringify(row?.payload),
      );
      check("an unrecognized type still yields 400, never a 500", response.status === 400);
    }
    {
      // The reason the type cannot simply be passed through: it is attacker
      // controlled, and `submissions.type` has a CHECK constraint.
      const { response, row } = await post({ type: "x".repeat(5000), payload: {}, honeypot: "bot" });
      check("a 5000-char type does not reach the type column", row?.type === "unknown");
      check(
        "the forensic copy is truncated (never an unbounded attacker string)",
        row?.payload?.submitted_type.length === 64,
        `len=${row?.payload?.submitted_type?.length}`,
      );
      check("still a 400", response.status === 400);
    }
    {
      const { row } = await post({ type: { evil: true }, payload: {}, honeypot: "bot" });
      check("a non-string type is filed as unknown", row?.type === "unknown", `got ${row?.type}`);
      check(
        "a non-string type records no forensic string",
        row?.payload?.submitted_type === undefined,
        JSON.stringify(row?.payload),
      );
    }
    {
      const { row } = await post({ payload: {}, honeypot: "bot" });
      check("a missing type is filed as unknown", row?.type === "unknown", `got ${row?.type}`);
    }

    /* ---------------- Every rejected row keeps its marker ---------------- */

    {
      const { row } = await post({ type: "cv_capture", payload: { session_id: "x" }, honeypot: "bot" });
      check(
        "the rejected payload still records the honeypot reason",
        row?.payload?.rejected === "honeypot",
        JSON.stringify(row?.payload),
      );
      check("the source ip is hashed, never raw", typeof row?.source_ip_hash === "string" && !row.source_ip_hash.includes("203.0.113.7"));
    }

    /* ---------------- The clean path is untouched ---------------- */

    {
      const { response, row } = await post({ type: "add_segment", payload: VALID_ADD, honeypot: "" });
      check("a clean add_segment still returns 201", response.status === 201, `got ${response.status}`);
      check("a clean add_segment still persists as pending", row?.status === "pending" && row?.type === "add_segment");
      check("a clean add_segment is not flagged", row?.honeypot_tripped === false);
    }
    {
      const { response } = await post({ type: "add_segment", payload: { name: "" }, honeypot: "" });
      check("an invalid payload still returns 400", response.status === 400);
    }
    {
      // cv_capture has no envelope schema in lib/schemas.ts yet, so a clean
      // (non-honeypot) cv_capture is still rejected as invalid. That is
      // correct for now: unit-capture-review owns that envelope.
      const { response } = await post({
        type: "cv_capture",
        payload: { session_id: "0b8a9a1e-0e6e-4c9a-9f0d-9a1f2b3c4d5e" },
        honeypot: "",
      });
      check(
        "a clean cv_capture is still rejected (no envelope schema yet — later unit)",
        response.status === 400,
        `got ${response.status}`,
      );
    }

    rmSync(BUILD_DIR, { recursive: true, force: true });

    console.log(
      failures.length === 0
        ? "\nPASS — honeypot preserves the submitted type"
        : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  })();
}

main();
