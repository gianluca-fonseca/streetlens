#!/usr/bin/env node
/**
 * test-capture-migrations.mjs (u25 capture contracts)
 *
 * Applies the WHOLE migration chain (0001..0014) to a throwaway PostGIS
 * container and exercises the capture RPCs against it. The live Supabase is
 * never touched — this is a scratch database that is destroyed on exit.
 *
 * Why bother: a migration only gets applied at the wave boundary, so a syntax
 * error or a broken RPC would otherwise surface late and block every other
 * unit. This proves the SQL parses, the constraints bite, and the security
 * model actually holds before anyone applies it for real.
 *
 * Requires docker. SKIPS (exit 0) when docker is unavailable, so it never
 * blocks a machine without it — the Conductor still applies the real thing.
 *
 * Usage: node scripts/test-capture-migrations.mjs
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const CONTAINER = "streetlens-migration-check";
// The real Supabase Postgres image: it already carries postgis, pgcrypto and
// the anon/authenticated roles, so the check runs against what production
// actually is rather than a lookalike.
const IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.143";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
}

/** Run SQL in the container; returns stdout. Throws on SQL error. */
function psql(sql, { quiet = true } = {}) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...(quiet ? ["-qtA"] : [])],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

/** Expect SQL to fail, and return the error text. */
function psqlExpectError(sql) {
  try {
    psql(sql);
    return null;
  } catch (err) {
    return String(err.stderr || err.message);
  }
}

function cleanup() {
  try { sh(`docker rm -f ${CONTAINER}`); } catch { /* not running */ }
}

function main() {
  try {
    sh("docker info");
  } catch {
    console.log("SKIP — docker unavailable; migrations unverified locally.");
    process.exit(0);
  }

  cleanup();
  console.log(`Starting ${IMAGE}...`);
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust ${IMAGE}`,
  );

  try {
    // Wait for readiness — and then keep waiting.
    //
    // This image runs its own init after first accepting connections, and that
    // init RESTARTS postgres. pg_isready goes green during that window, so
    // trusting it gets you a connection killed mid-migration ("terminating
    // connection due to administrator command"). Require a run of consecutive
    // successful queries instead, which only happens once init is done.
    let streak = 0;
    for (let i = 0; i < 120 && streak < 8; i++) {
      try {
        sh(`docker exec ${CONTAINER} psql -U supabase_admin -d postgres -qtAc "select 1"`);
        streak += 1;
      } catch {
        streak = 0;
      }
      execSync("sleep 1");
    }
    if (streak < 8) throw new Error("postgres never settled");

    // This image boots without the init scripts the full Supabase stack runs,
    // which leaves the pg_graphql / pg_net / postgrest DDL event triggers
    // half-initialized: they fire on `create extension` and die on a dangling
    // OID. None of them have anything to do with our schema, so switch them off
    // for the duration. (This is why psql connects as supabase_admin — it owns
    // them; the `postgres` role does not.)
    psql(`
      do $$
      declare r record;
      begin
        for r in select evtname from pg_event_trigger loop
          execute format('alter event trigger %I disable', r.evtname);
        end loop;
      end $$;
    `);

    // The image ships postgis, pgcrypto and the anon/authenticated roles, but
    // storage.buckets/objects are created by the storage service rather than
    // the database image. Stub ONLY those two, with the columns the migration
    // touches — everything else here is the real thing.
    psql(`
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key,
        name text not null,
        public boolean default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets (id),
        name text,
        owner uuid
      );
      alter table storage.objects enable row level security;
    `);

    /* ---------------- Apply the chain ---------------- */

    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    check("found the full migration chain through 0014", files.some((f) => f.startsWith("0014")), files.join(" "));

    for (const file of files) {
      try {
        psql(readFileSync(path.join(MIGRATIONS, file), "utf8"));
        if (file.startsWith("0013") || file.startsWith("0014")) {
          check(`${file} applies cleanly`, true);
        }
      } catch (err) {
        check(`${file} applies cleanly`, false, `\n${String(err.stderr || err.message).slice(0, 1500)}`);
        throw new Error(`migration ${file} failed`);
      }
    }

    /* ---------------- Idempotency ---------------- */

    try {
      psql(readFileSync(path.join(MIGRATIONS, "0013_capture.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0014_submission_types.sql"), "utf8"));
      check("0013 + 0014 are re-runnable (idempotent)", true);
    } catch (err) {
      check("0013 + 0014 are re-runnable (idempotent)", false, String(err.stderr || err.message).slice(0, 800));
    }

    /* ---------------- Schema shape ---------------- */

    const tables = psql(`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'capture_%' order by 1;
    `).trim().split("\n").filter(Boolean);
    check(
      "all five capture tables exist",
      ["capture_frame_jobs", "capture_frames", "capture_observations", "capture_segment_rollups", "capture_sessions"]
        .every((t) => tables.includes(t)),
      tables.join(" "),
    );

    check(
      "capture_sessions.track is geography, not geometry",
      psql(`select udt_name from information_schema.columns
              where table_name='capture_sessions' and column_name='track';`).trim() === "geography",
    );
    check(
      "capture_frames.t is bigint (epoch ms overflows int4)",
      psql(`select data_type from information_schema.columns
              where table_name='capture_frames' and column_name='t';`).trim() === "bigint",
    );

    const rlsOff = psql(`
      select relname from pg_class
       where relname like 'capture_%' and relkind = 'r' and not relrowsecurity;
    `).trim();
    check("RLS is enabled on every capture table", rlsOff === "", rlsOff);

    const policies = psql(`
      select count(*) from pg_policies where schemaname='public' and tablename like 'capture_%';
    `).trim();
    check(
      "capture tables have ZERO policies (deny-by-default; RPCs are the only way in)",
      policies === "0",
      `${policies} policies`,
    );

    check(
      "the GIST indexes exist",
      psql(`select count(*) from pg_indexes where indexname in
              ('capture_sessions_track_gix','capture_frames_location_gix');`).trim() === "2",
    );

    /* ---------------- Storage ---------------- */

    const bucket = psql(`
      select public::text || '|' || file_size_limit::text || '|' || array_to_string(allowed_mime_types, ',')
        from storage.buckets where id='streetlens-frames';
    `).trim();
    check("the frames bucket is public-read, 2 MB, jpeg-only", bucket === "true|2097152|image/jpeg", bucket);

    const storagePolicies = psql(`
      select policyname || ':' || cmd from pg_policies
       where schemaname='storage' and tablename='objects' order by 1;
    `).trim();
    check(
      "storage has exactly one INSERT policy and no update/delete policy",
      storagePolicies === "capture_frames_anon_insert:INSERT",
      storagePolicies,
    );

    /* ---------------- 0014: the type vocabulary ---------------- */

    psql(`insert into submissions (type, payload) values ('cv_capture', '{"session_id":"x"}'::jsonb);`);
    check("submissions accepts cv_capture", true);
    psql(`insert into submissions (type, payload) values ('unknown', '{"rejected":"honeypot"}'::jsonb);`);
    check("submissions accepts unknown (the honeypot landing place)", true);
    check(
      "submissions still rejects a garbage type",
      psqlExpectError(`insert into submissions (type, payload) values ('nonsense', '{}'::jsonb);`) !== null,
    );
    psql(`insert into submissions (type, payload) values ('add_segment', '{}'::jsonb);`);
    check("the two original types still work (manual flow unchanged)", true);

    /* ---------------- RPCs: the public path ---------------- */

    const sid = psql(`select capture_create_session('live', 'iphash-a', 'me@example.com');`).trim();
    check("capture_create_session returns a session uuid", /^[0-9a-f-]{36}$/.test(sid), sid);
    check(
      "a new session starts at pending_upload",
      psql(`select status from capture_sessions where id='${sid}';`).trim() === "pending_upload",
    );
    check(
      "an invalid mode is rejected",
      psqlExpectError(`select capture_create_session('telepathy', 'iphash-z');`) !== null,
    );

    // Rate limit: 3/hour/IP, enforced in the DB (not just the in-memory bucket).
    psql(`select capture_create_session('live', 'iphash-rl');`);
    psql(`select capture_create_session('live', 'iphash-rl');`);
    psql(`select capture_create_session('live', 'iphash-rl');`);
    check(
      "a 4th session from one origin within the hour is rate_limited IN THE DATABASE",
      (psqlExpectError(`select capture_create_session('live', 'iphash-rl');`) || "").includes("rate_limited"),
    );
    check(
      "the ceiling is per-origin: a different ip hash is unaffected",
      /^[0-9a-f-]{36}$/.test(psql(`select capture_create_session('live', 'iphash-other');`).trim()),
    );

    const accepted = psql(`
      select capture_register_frames('${sid}'::uuid,
        '[{"seq":0,"t":1784000000000,"width":1920,"height":1080,"bytes":500000},
          {"seq":1,"t":1784000001000,"width":1920,"height":1080,"bytes":500000}]'::jsonb);
    `).trim();
    check("capture_register_frames returns the accepted seqs", accepted === "{0,1}", accepted);
    check(
      "registering moves the session to uploading and counts the frames",
      psql(`select status || '|' || frame_count from capture_sessions where id='${sid}';`).trim() === "uploading|2",
    );
    check(
      "the storage path is DERIVED server-side, never taken from the client",
      psql(`select storage_path from capture_frames where session_id='${sid}' and seq=1;`).trim() ===
        `captures/${sid}/frame-0001.jpg`,
    );
    {
      // A client trying to smuggle its own path gets the derived one anyway.
      const s2 = psql(`select capture_create_session('live', 'iphash-b');`).trim();
      psql(`select capture_register_frames('${s2}'::uuid,
        '[{"seq":0,"t":1784000000000,"width":10,"height":10,"bytes":10,"storagePath":"captures/evil/../../secret.jpg"}]'::jsonb);`);
      check(
        "a client-supplied storagePath is ignored",
        psql(`select storage_path from capture_frames where session_id='${s2}' and seq=0;`).trim() ===
          `captures/${s2}/frame-0000.jpg`,
      );
    }
    check(
      "re-registering the same seq is idempotent (retry-safe), not a duplicate",
      psql(`
        select capture_register_frames('${sid}'::uuid,
          '[{"seq":0,"t":1784000000000,"width":1920,"height":1080,"bytes":500000}]'::jsonb);
      `).trim() === "{0,1}" &&
        psql(`select count(*) from capture_frames where session_id='${sid}';`).trim() === "2",
    );
    check(
      "an oversized frame is rejected by the CHECK",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":5,"t":1784000000000,"width":1920,"height":1080,"bytes":9999999}]'::jsonb);`) !== null,
    );
    check(
      "seq >= 400 is rejected by the CHECK",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":400,"t":1784000000000,"width":1920,"height":1080,"bytes":100}]'::jsonb);`) !== null,
    );

    const status = psql(`select capture_session_status('${sid}'::uuid);`).trim();
    check("capture_session_status returns the progress shape", status.includes('"status"') && status.includes('"jobs"'), status.slice(0, 160));
    check(
      "session status leaks NO ip hash and NO contact",
      !status.includes("iphash-a") && !status.includes("me@example.com"),
      status.slice(0, 160),
    );
    check(
      "reading an unknown session raises rather than returning null",
      psqlExpectError(`select capture_session_status('11111111-1111-4111-8111-111111111111'::uuid);`) !== null,
    );

    const finalized = psql(`
      select capture_finalize_session('${sid}'::uuid,
        '[{"lat":9.907,"lng":-84.152},{"lat":9.907,"lng":-84.150}]'::jsonb, 250);
    `).trim();
    check("capture_finalize_session hands the session to the matcher", finalized === "matching", finalized);
    check(
      "finalize writes a real geography LineString",
      psql(`select st_geometrytype(track::geometry) from capture_sessions where id='${sid}';`).trim() === "ST_LineString",
    );
    check(
      "finalize records the clock offset without touching the track",
      psql(`select clock_offset_ms from capture_sessions where id='${sid}';`).trim() === "250",
    );
    check(
      "finalize enqueues exactly one job per frame",
      psql(`select count(*) from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${sid}';`).trim() === "2",
    );
    check(
      "a finalized session cannot be finalized again (no track rewrite)",
      psqlExpectError(`select capture_finalize_session('${sid}'::uuid, '[{"lat":9,"lng":-84},{"lat":9.1,"lng":-84.1}]'::jsonb, 0);`) !== null,
    );
    check(
      "a finalized session no longer accepts frames",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":9,"t":1784000000000,"width":10,"height":10,"bytes":10}]'::jsonb);`) !== null,
    );

    /* ---------------- RPCs: the privileged path ---------------- */

    check(
      "capture_claim_jobs without the secret is unauthorized",
      (psqlExpectError(`select * from capture_claim_jobs(5, 'wrong-secret');`) || "").includes("unauthorized"),
    );
    check(
      "the secret gate holds even when app_secrets has no row yet",
      (psqlExpectError(`select * from capture_claim_jobs(5, null);`) || "").includes("unauthorized"),
    );

    psql(`insert into app_secrets (key, value) values ('admin_rpc_secret', 'test-secret')
            on conflict (key) do update set value = excluded.value;`);

    const claimed = psql(`select count(*) from capture_claim_jobs(5, 'test-secret');`).trim();
    check("capture_claim_jobs claims the pending jobs with the right secret", claimed === "2", claimed);
    check(
      "claiming marks them running and counts the attempt",
      psql(`select count(*) from capture_frame_jobs where status='running' and attempts=1;`).trim() === "2",
    );
    check(
      "a second claim returns nothing (no double-spend on the same frame)",
      psql(`select count(*) from capture_claim_jobs(5, 'test-secret');`).trim() === "0",
    );

    const frameId = psql(`select id from capture_frames where session_id='${sid}' and seq=0;`).trim();
    psql(`select capture_complete_job('${frameId}'::uuid, 'gpt-5-mini',
            '{"sidewalk_present":{"value":1,"confidence":0.9}}'::jsonb, true, 0.87, 1200, 300, false, 'test-secret');`);
    check(
      "capture_complete_job stores the observation and closes the job",
      psql(`select count(*) from capture_observations where frame_id='${frameId}';`).trim() === "1" &&
        psql(`select status from capture_frame_jobs where frame_id='${frameId}';`).trim() === "done",
    );
    psql(`select capture_complete_job('${frameId}'::uuid, 'gpt-5-mini',
            '{"sidewalk_present":{"value":0,"confidence":0.4}}'::jsonb, true, 0.4, 1200, 300, false, 'test-secret');`);
    check(
      "re-running one model REPLACES its answer rather than double-counting",
      psql(`select count(*) from capture_observations where frame_id='${frameId}';`).trim() === "1",
    );
    psql(`select capture_complete_job('${frameId}'::uuid, 'gpt-5',
            '{"sidewalk_present":{"value":1,"confidence":0.99}}'::jsonb, true, 0.99, 2000, 400, true, 'test-secret');`);
    check(
      "a DIFFERENT model on the same frame is kept alongside (A/B, escalation)",
      psql(`select count(*) from capture_observations where frame_id='${frameId}';`).trim() === "2",
    );

    const frame2 = psql(`select id from capture_frames where session_id='${sid}' and seq=1;`).trim();
    psql(`select capture_fail_job('${frame2}'::uuid, 'failed_overbudget', 'budget exhausted', 'test-secret');`);
    check(
      "failed_overbudget is recorded distinctly from failed (it is retryable)",
      psql(`select status from capture_frame_jobs where frame_id='${frame2}';`).trim() === "failed_overbudget",
    );
    check(
      "an invalid job status is rejected",
      psqlExpectError(`select capture_fail_job('${frame2}'::uuid, 'vibing', 'x', 'test-secret');`) !== null,
    );

    psql(`select capture_upsert_rollup('${sid}'::uuid, 'esc-sa-0001',
            '{"overall":72.5,"accessibility":60,"drainage":80,"shade":45,"bike":30}'::jsonb,
            '{"sidewalk_present":1}'::jsonb, 0.75, 0.82, 'test-secret');`);
    check(
      "capture_upsert_rollup writes the per-segment rollup",
      psql(`select score_overall::text from capture_segment_rollups
              where session_id='${sid}' and segment_id='esc-sa-0001';`).trim() === "72.50",
    );
    psql(`select capture_upsert_rollup('${sid}'::uuid, 'esc-sa-0001',
            '{"overall":50}'::jsonb, '{}'::jsonb, 0.5, 0.5, 'test-secret');`);
    check(
      "re-rolling one segment updates in place (one row per session+segment)",
      psql(`select count(*) from capture_segment_rollups where session_id='${sid}';`).trim() === "1",
    );
    check(
      "an out-of-range score is rejected by the CHECK",
      psqlExpectError(`select capture_upsert_rollup('${sid}'::uuid, 'esc-sa-0002',
        '{"overall":150}'::jsonb, '{}'::jsonb, 0.5, 0.5, 'test-secret');`) !== null,
    );

    check(
      "the rollup now surfaces in the public session status",
      psql(`select capture_session_status('${sid}'::uuid);`).includes("esc-sa-0001"),
    );

    psql(`select capture_set_session_status('${sid}'::uuid, 'review_ready', 'test-secret');`);
    check(
      "capture_set_session_status stamps the lifecycle timestamp",
      // boolean::text is 'true'/'false' in psql, not 't'/'f'.
      psql(`select (status='review_ready' and extracted_at is not null)::text
              from capture_sessions where id='${sid}';`).trim() === "true",
    );
    check(
      "status transitions are secret-gated too",
      (psqlExpectError(`select capture_set_session_status('${sid}'::uuid, 'approved', 'nope');`) || "").includes("unauthorized"),
    );

    /* ---------------- Cascades ---------------- */

    psql(`delete from capture_sessions where id='${sid}';`);
    check(
      "deleting a session cascades to frames, jobs, observations and rollups",
      psql(`select
              (select count(*) from capture_frames where session_id='${sid}')::text || '|' ||
              (select count(*) from capture_segment_rollups where session_id='${sid}')::text || '|' ||
              (select count(*) from capture_observations where frame_id='${frameId}')::text;`).trim() === "0|0|0",
    );

    /* ---------------- The anon role really is locked out ---------------- */

    // A live session must exist for this to prove anything — asserting "anon
    // sees 0 rows" against an empty table would pass with RLS switched off.
    const secret = psql(`select capture_create_session('live', 'iphash-secret', 'private@example.com');`).trim();
    check(
      "the owner CAN see the session (so the next check is not vacuous)",
      psql(`select count(*) from capture_sessions where id='${secret}';`).trim() === "1",
    );
    psql(`grant usage on schema public to anon;`);
    const anonCount = (() => {
      try {
        return psql(`set role anon; select count(*) from capture_sessions where id='${secret}'; reset role;`).trim();
      } catch {
        return "denied";
      }
    })();
    check(
      "anon cannot read that session directly — only the RPCs let anything out",
      anonCount === "denied" || anonCount === "0",
      `anon saw: ${anonCount}`,
    );
    const anonWrite = psqlExpectError(`
      set role anon;
      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes)
      values ('${secret}', 0, 'captures/x/frame-0000.jpg', 1784000000000, 10, 10, 10);
    `);
    check("anon cannot forge a capture_frames row (which would authorize an upload)", anonWrite !== null);
  } finally {
    cleanup();
  }

  console.log(
    failures.length === 0
      ? "\nPASS — migrations apply and the capture RPCs behave"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
