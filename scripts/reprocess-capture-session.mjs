#!/usr/bin/env node
/**
 * reprocess-capture-session.mjs — re-run map matching on a stuck capture session
 * against the CURRENT street network, re-queue the frames that now match, and
 * hand the session back to the extraction pump.
 *
 * WHEN TO USE IT. A session whose frames all failed `no_segment_match` because
 * the walk was outside the audited network at the time. Once an expansion puts
 * streets under that walk (data/segments.geojson has grown), this re-matches the
 * stored track locally and commits the fresh attribution through the secret-gated
 * reprocess RPC (0019). The track is unchanged; only the network moved.
 *
 * HOW IT STAYS HONEST. It re-runs the REAL HMM (lib/matching), the same matcher
 * finalize uses, compiled here exactly as scripts/test-matching-hmm.mjs does. It
 * never writes tables directly — every write is a SECURITY DEFINER RPC gated by
 * ADMIN_RPC_SECRET, the same path the worker uses. --dry-run stops after the
 * match summary and touches nothing.
 *
 * USAGE:
 *   node --env-file=.env.local scripts/reprocess-capture-session.mjs <session-id> [--dry-run]
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * ADMIN_RPC_SECRET. Optional CAPTURE_APP_URL to auto-kick the pump after a live
 * run; without it the script prints the exact pump command to run by hand.
 *
 * Exits 0 on success or a clean no-op (nothing to fix), non-zero on failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildTrackFromSession,
  buildAttributionPayload,
  summarizeAttribution,
  loadSegments,
} from "./reprocess-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function die(message) {
  console.error(`ERROR — ${message}`);
  process.exit(1);
}

/** A clean stop: the tool did its job, there was simply nothing to change. */
function noop(message) {
  console.log(`no-op — ${message}`);
  process.exit(0);
}

/* ---------------- args + env ---------------- */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sessionId = args.find((a) => !a.startsWith("--"));

if (!sessionId) {
  die("usage: node --env-file=.env.local scripts/reprocess-capture-session.mjs <session-id> [--dry-run]");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
  die(`not a session uuid: ${sessionId}`);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_SECRET = process.env.ADMIN_RPC_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON || !ADMIN_SECRET) {
  die("need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_RPC_SECRET (run with --env-file=.env.local)");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) die(`${name}: ${error.message}`);
  return data;
}

/* ---------------- compile the real matcher (mirrors test-matching-hmm.mjs) ---------------- */

function loadMatcher() {
  const buildDir = path.join(ROOT, ".reprocess-build");
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  // lib/matching uses the "@/" alias, which tsc rejects on the CLI, so the
  // compile needs a real (throwaway) tsconfig with the path mapping.
  const tsconfig = path.join(buildDir, "tsconfig.json");
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
      files: [
        "../lib/matching/hmm.ts",
        "../lib/matching/graph.ts",
        "../lib/matching/baseline.ts",
        "../lib/matching/types.ts",
        "../lib/capture/types.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
  const matcher = require(path.join(buildDir, "matching", "hmm.js"));
  return { matcher, cleanup: () => rmSync(buildDir, { recursive: true, force: true }) };
}

/* ---------------- main ---------------- */

async function main() {
  console.log(`Reprocessing session ${sessionId}${dryRun ? " (dry-run)" : ""}\n`);

  const session = await rpc("capture_session_track", {
    p_session_id: sessionId,
    p_secret: ADMIN_SECRET,
  });
  const status = session.status;
  const track = Array.isArray(session.track) ? session.track : [];
  console.log(`  status:      ${status}`);
  console.log(`  frame count: ${session.frameCount}`);
  console.log(`  track points: ${track.length}`);

  // Client-side guards mirror the RPC's, so the operator learns why before any
  // write is attempted. The RPC enforces them again for real (defence in depth).
  if (status === "approved" || status === "rejected") {
    noop(`session is ${status}; a decided walk is history, not a retry target.`);
  }
  if (status !== "extracting" && status !== "review_ready") {
    noop(`session is ${status}; only extracting or review_ready sessions are reprocessable.`);
  }
  if (track.length < 2) {
    noop("session has no usable track to re-match (never finalized, or a single point).");
  }

  const frameRows = (await rpc("capture_list_frames", {
    p_session_id: sessionId,
    p_secret: ADMIN_SECRET,
  })) ?? [];
  if (frameRows.length === 0) {
    noop("session has no registered frames.");
  }
  const frames = frameRows.map((r) => ({ seq: r.seq, t: Number(r.t) }));
  const currentlyUnmatched = frameRows.filter((r) => r.segment_id == null).length;
  console.log(`  frames:      ${frames.length} (${currentlyUnmatched} currently unmatched)\n`);

  /* ---- re-match locally against the current network ---- */

  const segments = loadSegments(
    (p) => readFileSync(p, "utf8"),
    path.join(ROOT, "data", "segments.geojson"),
  );
  console.log(`  matching against ${segments.length} segments in data/segments.geojson...`);

  const { matcher, cleanup } = loadMatcher();
  let payload;
  let summary;
  try {
    const reTrack = buildTrackFromSession(track, frames);
    const match = matcher.matchTrack(reTrack, { frames, segments });
    const attribution = matcher.attributeFrames(match, frames);
    summary = summarizeAttribution(frames, attribution);
    payload = buildAttributionPayload(frames, attribution);
  } finally {
    cleanup();
  }

  console.log(`\n  match summary:`);
  console.log(`    ${summary.attributed}/${summary.total} frames placed on a segment, ${summary.unmatched} unmatched`);
  const segLines = Object.entries(summary.bySegment).sort((a, b) => b[1] - a[1]);
  for (const [seg, count] of segLines) {
    console.log(`      ${seg}: ${count} frame${count === 1 ? "" : "s"}`);
  }
  if (segLines.length === 0) {
    console.log("      (no segment would be matched)");
  }

  if (dryRun) {
    console.log(
      `\ndry-run — nothing written. A live run re-queues the currently-unmatched ` +
        `frames that now match; the pump then extracts them.`,
    );
    process.exit(0);
  }

  /* ---- commit ---- */

  const result = await rpc("capture_reprocess_session", {
    p_session_id: sessionId,
    p_attributions: payload,
    p_secret: ADMIN_SECRET,
  });

  console.log(`\n  reprocess result:`);
  console.log(`    previously unmatched (touched): ${result.reprocessed}`);
  console.log(`    re-queued (now match):          ${result.requeued}`);
  console.log(`    still unmatched:                ${result.stillUnmatched}`);
  console.log(`    session status:                 ${result.status}`);

  if (result.noop) {
    console.log(`\ndone — no frames needed re-queuing; the session was left as it was.`);
    process.exit(0);
  }

  /* ---- kick the pump so the re-queued frames get extracted ---- */

  const base = process.env.CAPTURE_APP_URL;
  const pumpCmd =
    `curl -X POST "${base ?? "<app-url>"}/api/capture/pump" ` +
    `-H "Authorization: Bearer $ADMIN_RPC_SECRET" ` +
    `-H "content-type: application/json" -d '{"limit":40}'`;

  if (base) {
    try {
      const res = await fetch(`${base}/api/capture/pump`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ADMIN_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 40 }),
      });
      const text = await res.text();
      console.log(`\n  pump kicked (${res.status}): ${text.slice(0, 200)}`);
      if (!res.ok) {
        console.log(`  the pump call did not return ok; run it again once the app is healthy:\n    ${pumpCmd}`);
      }
    } catch (err) {
      console.log(`\n  could not reach the pump (${err.message}). Run it by hand:\n    ${pumpCmd}`);
    }
  } else {
    console.log(
      `\n  next step — the frames are queued; kick the pump (needs the app running):\n    ${pumpCmd}`,
    );
  }

  console.log(`\ndone — ${result.requeued} frame(s) re-queued for extraction.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
