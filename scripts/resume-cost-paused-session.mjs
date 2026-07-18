#!/usr/bin/env node
/**
 * resume-cost-paused-session.mjs — resume a cost_paused capture session.
 *
 * WHEN TO USE IT. A session tripped the extraction budget breaker and sits in
 * `cost_paused` with `failed_overbudget` frames. After a human decides to spend
 * more (or the budget was raised), this flips the session back to `extracting`,
 * requeues those frames, and records who resumed and why.
 *
 * This is NOT reprocess: reprocess is for no_segment_match only (0019).
 *
 * USAGE:
 *   node --env-file=.env.local scripts/resume-cost-paused-session.mjs <session-id> --reason "..." [--actor "ops@example.com"] [--dry-run]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_RPC_SECRET.
 * Optional CAPTURE_APP_URL to auto-kick the pump after a live run.
 *
 * Exits 0 on success, non-zero on failure.
 */

import { createClient } from "@supabase/supabase-js";

function die(message) {
  console.error(`ERROR — ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reasonIdx = args.indexOf("--reason");
const actorIdx = args.indexOf("--actor");
const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : null;
const actor = actorIdx >= 0 ? args[actorIdx + 1] : process.env.RESUME_ACTOR ?? "operator";
const sessionId = args.find(
  (a, i) =>
    !a.startsWith("--") &&
    i !== reasonIdx + 1 &&
    i !== actorIdx + 1 &&
    /^[0-9a-f-]{36}$/i.test(a),
);

if (!sessionId) {
  die(
    "usage: node --env-file=.env.local scripts/resume-cost-paused-session.mjs <session-id> --reason \"...\" [--actor name] [--dry-run]",
  );
}
if (!reason || !reason.trim()) {
  die("--reason is required (non-empty)");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_SECRET = process.env.ADMIN_RPC_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON || !ADMIN_SECRET) {
  die("need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ADMIN_RPC_SECRET");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function main() {
  const track = await rpc("capture_session_track", {
    p_session_id: sessionId,
    p_secret: ADMIN_SECRET,
  });
  if (track.status !== "cost_paused") {
    die(`session is ${track.status}, not cost_paused — nothing to resume`);
  }

  console.log(`session ${sessionId} is cost_paused (${track.frameCount} frames)`);
  if (dryRun) {
    console.log("dry-run — would call capture_resume_cost_paused and kick the pump");
    process.exit(0);
  }

  const result = await rpc("capture_resume_cost_paused", {
    p_session_id: sessionId,
    p_actor: actor,
    p_reason: reason.trim(),
    p_secret: ADMIN_SECRET,
  });
  console.log(`resumed → extracting, requeued ${result.requeued ?? 0} failed_overbudget job(s)`);

  const appUrl = process.env.CAPTURE_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    const pumpUrl = `${appUrl.replace(/\/$/, "")}/api/capture/pump`;
    const res = await fetch(pumpUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    if (!res.ok) {
      console.warn(`pump kick returned ${res.status} — run manually: curl -X POST -H "Authorization: Bearer $ADMIN_RPC_SECRET" ${pumpUrl}`);
    } else {
      const body = await res.json();
      console.log(`pump: claimed=${body.claimed ?? 0} remaining=${body.remaining ?? "?"}`);
    }
  } else {
    console.log(`kick the pump: curl -X POST -H "Authorization: Bearer $ADMIN_RPC_SECRET" <app>/api/capture/pump`);
  }
}

main().catch((err) => die(err.message));
