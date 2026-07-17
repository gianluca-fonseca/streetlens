#!/usr/bin/env node
/**
 * live-e2e-lifecycle.mjs — the whole CV funnel, live, end to end.
 *
 * Drives the real HTTP routes against a running server AND the real Supabase
 * project, on the real segment esc-sa-0001 ("Calle 130"):
 *
 *   create session (POST /api/capture/sessions)
 *     -> register frames (POST .../frames)                  arms the storage RLS
 *     -> upload frame BYTES to storage as anon              exercises 0016 policy
 *     -> finalize with a real GPS track (POST .../finalize) HMM match -> esc-sa-0001
 *     -> pump the job queue (POST /api/capture/pump)        real gpt-5-nano extraction
 *     -> rollups + auto-emit of the cv_capture submission   (pump, on drain)
 *     -> capture_session_review (RPC)                       the full admin payload
 *     -> capture_emit_submission (RPC, idempotent)          files/keeps the queue row
 *     -> capture_close_review('reject', ...) (RPC)          NO fake data reaches the map
 *     -> community_cv_observations stays EMPTY for the session
 *
 * WHY LIVE. Everything here is only knowable against the real project: that the
 * 0016 storage policy actually authorizes a registered upload (mocked tests
 * cannot see RLS), that the HMM matcher attributes a real track to a real
 * segment, that extraction bills under the ceiling on a real frame, and that the
 * 0017 review RPCs land exactly what an admin approved (here: nothing — we reject
 * on purpose so this evidence run leaves the public map untouched).
 *
 * It bills real model calls (one per frame, downscaled to 512 px). Keep the frame
 * count tiny. Gated behind RUN_LIVE_E2E=1 and skips cleanly otherwise.
 *
 *   RUN_LIVE_E2E=1 E2E_BASE=http://localhost:3560 \
 *     node --env-file=.env.local scripts/live-e2e-lifecycle.mjs
 *
 * Needs a server already running at E2E_BASE (next start / next dev) built with
 * the same .env.local, plus NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / ADMIN_RPC_SECRET.
 * Exits 0 on PASS or SKIP, 1 on any failed check.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "street-real.jpg");

const BASE = (process.env.E2E_BASE || "http://localhost:3560").replace(/\/+$/, "");
const BUCKET = "streetlens-frames"; // lib/capture/types.ts CAPTURE_BUCKET
const SEGMENT_ID = "esc-sa-0001"; // data/segments.geojson "Calle 130"
// >= DEFAULT_MIN_TRAVERSAL_FRAMES (3, lib/matching/hmm.ts): a segment traversal
// carrying fewer frames is dropped, which would leave every frame unattributed
// ("no_segment_match") and fail its job before extraction ever runs.
const FRAME_COUNT = 4; // = 4 real model calls, still cheap

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_SECRET = process.env.ADMIN_RPC_SECRET;

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
function step(n, title) {
  console.log(`\n=== ${n}. ${title} ===`);
}

if (process.env.RUN_LIVE_E2E !== "1") {
  console.log("SKIP — live E2E is gated: set RUN_LIVE_E2E=1 (this one bills real calls and writes to the live DB)");
  process.exit(0);
}
if (!SUPABASE_URL || !SUPABASE_ANON || !ADMIN_SECRET) {
  console.log("SKIP — need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_RPC_SECRET (export from .env.local)");
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

async function api(method, urlPath, body, headers = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* some responses are empty */
  }
  return { status: res.status, json };
}

// A GPS track that walks Calle 130 end to end: interpolate along the segment's
// three vertices, monotonic in time. >=10 fixes over >=30 s so a `live` source
// clears validateTrack's floors, and each fix is within the matcher's snap gate.
function buildTrack(t0) {
  const verts = [
    [-84.13841, 9.915884],
    [-84.138385, 9.916761],
    [-84.138339, 9.917601],
  ];
  const N = 12;
  const stepMs = 3000; // 11 gaps -> 33 s span
  const fixes = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1); // 0..1 along the whole polyline
    // Two equal-length legs for simplicity: [0,0.5]=v0->v1, [0.5,1]=v1->v2.
    let lng, lat;
    if (u <= 0.5) {
      const k = u / 0.5;
      lng = verts[0][0] + (verts[1][0] - verts[0][0]) * k;
      lat = verts[0][1] + (verts[1][1] - verts[0][1]) * k;
    } else {
      const k = (u - 0.5) / 0.5;
      lng = verts[1][0] + (verts[2][0] - verts[1][0]) * k;
      lat = verts[1][1] + (verts[2][1] - verts[1][1]) * k;
    }
    fixes.push({ lat, lng, t: t0 + i * stepMs, accuracy: 5, speed: 1.2 });
  }
  return fixes;
}

async function main() {
  const bytes = readFileSync(FIXTURE);
  const buf = Buffer.from(bytes);
  // Dimensions of the fixture (baseline JPEG) for frame metadata.
  const dims = readJpegSize(bytes);
  console.log(`live E2E against ${BASE}`);
  console.log(`  fixture ${path.basename(FIXTURE)} ${dims.width}x${dims.height} ${(buf.length / 1024).toFixed(0)} KB`);
  console.log(`  segment ${SEGMENT_ID}, ${FRAME_COUNT} frames (=${FRAME_COUNT} real extraction calls)`);

  // --- 1. create ------------------------------------------------------------
  step(1, "create session");
  const create = await api("POST", "/api/capture/sessions", { mode: "live" });
  console.log(`  POST /api/capture/sessions -> ${create.status} ${JSON.stringify(create.json)}`);
  check("session created (201)", create.status === 201 && !!create.json?.sessionId);
  if (create.status !== 201) {
    if (create.status === 429) console.error("  (rate limited: create is 3/hr/IP — wait or use a fresh IP)");
    return finish();
  }
  const sessionId = create.json.sessionId;
  const framePath = (seq) => `captures/${sessionId}/frame-${String(seq).padStart(4, "0")}.jpg`;

  // --- 2. register ----------------------------------------------------------
  step(2, "register frames");
  const t0 = Date.now();
  const frames = [];
  for (let seq = 0; seq < FRAME_COUNT; seq++) {
    frames.push({
      seq,
      t: t0 + 6000 + seq * 6000, // spread across the track window (6s,12s,18s,24s)
      storagePath: framePath(seq),
      width: dims.width,
      height: dims.height,
      bytes: buf.length,
    });
  }
  const reg = await api("POST", `/api/capture/sessions/${sessionId}/frames`, { frames });
  console.log(`  POST .../frames (${FRAME_COUNT}) -> ${reg.status} ${JSON.stringify(reg.json)}`);
  check("frames registered (200)", reg.status === 200 && Array.isArray(reg.json?.accepted) && reg.json.accepted.length === FRAME_COUNT);

  // --- 3. upload the bytes (anon, direct to storage) ------------------------
  step(3, "upload frame bytes to storage (0016 registration-armed policy)");
  // A PLAIN insert (no upsert): the 0016 policy grants anon INSERT only, and an
  // upsert compiles to INSERT ... ON CONFLICT DO UPDATE, which Postgres also
  // gates on an UPDATE policy anon does not have — so upsert:true would be
  // refused even on a first write. Each run uses a fresh session uuid, so the
  // object path is new and a plain insert never conflicts.
  for (let seq = 0; seq < FRAME_COUNT; seq++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(framePath(seq), buf, { contentType: "image/jpeg" });
    console.log(`  PUT ${framePath(seq)} -> ${error ? "FAIL " + error.message : "ok"}`);
    check(`frame ${seq} uploaded to a registered path`, !error, error ? `(${error.message})` : "");
  }

  // Negative control: an UNregistered path must still be refused by RLS.
  step(4, "storage RLS negative control (unregistered path refused)");
  const badPath = `captures/${sessionId}/frame-0099.jpg`;
  const { error: badErr } = await supabase.storage
    .from(BUCKET)
    .upload(badPath, buf, { contentType: "image/jpeg" });
  console.log(`  PUT ${badPath} (never registered) -> ${badErr ? "refused: " + badErr.message : "UPLOADED (should not happen)"}`);
  check("an unregistered path is refused", !!badErr);

  // --- 5. status before finalize -------------------------------------------
  step(5, "status before finalize");
  const pre = await api("GET", `/api/capture/sessions/${sessionId}`);
  console.log(`  GET .../${sessionId} -> ${pre.status} ${JSON.stringify(pre.json)}`);
  check("status is uploading with the frames on record", pre.json?.status === "uploading" && pre.json?.frameCount === FRAME_COUNT);

  // --- 6. finalize ----------------------------------------------------------
  step(6, "finalize (real track along esc-sa-0001, HMM match + attribution + enqueue)");
  const track = buildTrack(t0);
  const fin = await api("POST", `/api/capture/sessions/${sessionId}/finalize`, { track, source: "live", clockOffsetMs: 0 });
  console.log(`  POST .../finalize (${track.length} fixes) -> ${fin.status} ${JSON.stringify(fin.json)}`);
  check("finalize accepted, session extracting", fin.status === 200 && fin.json?.status === "extracting");

  // --- 7. pump the queue (real extraction) ----------------------------------
  // Use the SESSION-SCOPED pump (0017 capture_claim_jobs_for_session): it claims
  // only this walk's frames (never other sessions'), and pumpOnce still rolls up
  // and auto-emits the cv_capture submission when the queue drains. Locally there
  // is no serverless maxDuration cutoff, so one call can process the whole batch.
  step(7, "pump the job queue (session-scoped; real gpt-5-nano extraction @ 512 px)");
  // One scoped pump kicks the queue; locally there is no serverless cutoff, so it
  // may process the whole batch in this single (blocking) call and return
  // review_ready itself. Then poll the UNMETERED status endpoint until the flip
  // lands, nudging the pump only sparsely so we stay under its 6/min budget.
  const kick = await api("POST", `/api/capture/sessions/${sessionId}/pump`);
  console.log(`  kick pump -> ${kick.status} ${JSON.stringify(kick.json)}`);
  const done = new Set(["review_ready", "approved", "rejected", "cost_paused"]);
  let statusJson = kick.json && done.has(kick.json.status) ? kick.json : null;
  for (let i = 0; i < 60 && !statusJson; i++) {
    await sleep(5000);
    const s = await api("GET", `/api/capture/sessions/${sessionId}`);
    console.log(`  poll #${i + 1} -> status=${s.json?.status} jobs=${JSON.stringify(s.json?.jobs)}`);
    if (done.has(s.json?.status)) {
      statusJson = s.json;
      break;
    }
    // Sparse nudge (~every 20s) in case after()'s pump did not pick it up; well
    // under the 6/min per-session pump limit.
    if (i % 4 === 3) {
      const n = await api("POST", `/api/capture/sessions/${sessionId}/pump`);
      console.log(`    nudge pump -> ${n.status} ${n.json ? `claimed ${n.json.claimed} done ${n.json.done} failed ${n.json.failed} status ${n.json.status}` : ""}`);
      if (n.json && done.has(n.json.status)) {
        statusJson = n.json;
        break;
      }
    }
  }
  check("session reached review_ready", statusJson?.status === "review_ready", `(status ${statusJson?.status})`);

  // --- 9. the admin review payload (0017 capture_session_review) -------------
  step(8, "capture_session_review — the full admin review payload");
  const { data: review, error: revErr } = await supabase.rpc("capture_session_review", {
    p_session_id: sessionId,
    p_secret: ADMIN_SECRET,
  });
  if (revErr) {
    check("capture_session_review returned", false, `(${revErr.message})`);
  } else {
    console.log("  payload:");
    console.log(JSON.stringify(review, null, 2).split("\n").map((l) => "    " + l).join("\n"));
    check("review status is review_ready", review?.status === "review_ready");
    check("tokens billed for the extracted frames", (review?.tokens?.inputTokens ?? 0) > 0 && (review?.tokens?.observations ?? 0) === FRAME_COUNT,
      `(input ${review?.tokens?.inputTokens}, obs ${review?.tokens?.observations})`);
    const roll = Array.isArray(review?.rollups) ? review.rollups.find((r) => r.segmentId === SEGMENT_ID) : null;
    check(`a rollup exists for ${SEGMENT_ID}`, !!roll);
    check("the rollup carries scores + coverage", !!roll && roll.scores && roll.coverage != null,
      roll ? `(overall ${roll.scores?.overall}, coverage ${roll.coverage})` : "");
    check("frames come back with their segment attribution", Array.isArray(review?.frames) && review.frames.length === FRAME_COUNT && review.frames.every((f) => f.segmentId === SEGMENT_ID));
  }

  // --- 10. emit is idempotent (0017 capture_emit_submission) -----------------
  step(9, "capture_emit_submission — files/keeps the cv_capture queue row (idempotent)");
  const { error: emitErr } = await supabase.rpc("capture_emit_submission", { p_session_id: sessionId, p_secret: ADMIN_SECRET });
  console.log(`  capture_emit_submission -> ${emitErr ? "FAIL " + emitErr.message : "ok (row present; second call is a no-op)"}`);
  check("emit succeeds and is idempotent", !emitErr);

  // --- 11. close as REJECT (no fake data reaches the map) --------------------
  step(10, "capture_close_review('reject') — leave NO approved data behind");
  const { error: closeErr } = await supabase.rpc("capture_close_review", {
    p_session_id: sessionId,
    p_action: "reject",
    p_reason: "integration-evidence cleanup",
    p_secret: ADMIN_SECRET,
  });
  console.log(`  capture_close_review(reject) -> ${closeErr ? "FAIL " + closeErr.message : "ok"}`);
  check("session rejected cleanly", !closeErr);

  const after = await api("GET", `/api/capture/sessions/${sessionId}`);
  console.log(`  GET .../${sessionId} -> ${after.status} status=${after.json?.status}`);
  check("session status is now rejected", after.json?.status === "rejected");

  // --- 12. the map stays clean ---------------------------------------------
  step(11, "community_cv_observations stays EMPTY for this session (we never approved)");
  const { data: obs, error: obsErr } = await supabase
    .from("community_cv_observations")
    .select("id")
    .eq("session_id", sessionId);
  console.log(`  select community_cv_observations where session=${sessionId} -> ${obsErr ? "err " + obsErr.message : (obs?.length ?? "?") + " rows"}`);
  check("no approved CV observations exist for this session", !obsErr && Array.isArray(obs) && obs.length === 0);

  // --- 13. best-effort storage cleanup -------------------------------------
  step(12, "storage cleanup (best effort — anon may lack DELETE)");
  const toRemove = [];
  for (let seq = 0; seq < FRAME_COUNT; seq++) toRemove.push(framePath(seq));
  const { data: removed, error: rmErr } = await supabase.storage.from(BUCKET).remove(toRemove);
  if (rmErr) {
    console.log(`  remove -> not permitted for anon (${rmErr.message}); rejected session frames are harmless test objects`);
  } else {
    console.log(`  remove -> deleted ${removed?.length ?? 0} object(s)`);
  }

  return finish();
}

function finish() {
  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — live E2E lifecycle (session ended rejected; map untouched)");
  process.exit(0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Minimal baseline-JPEG dimension reader (SOF marker), enough for our fixture.
function readJpegSize(b) {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { width: 0, height: 0 };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
