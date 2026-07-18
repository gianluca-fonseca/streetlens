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
    if (process.env.CI === "true") {
      console.error("FAIL — docker unavailable in CI; migration suite cannot run.");
      process.exit(1);
    }
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
    check("found the full migration chain through 0033", files.some((f) => f.startsWith("0033")), files.join(" "));

    for (const file of files) {
      try {
        psql(readFileSync(path.join(MIGRATIONS, file), "utf8"));
        if (file.startsWith("0013") || file.startsWith("0014") || file.startsWith("0017") || file.startsWith("0019") || file.startsWith("0020") || file.startsWith("0021") || file.startsWith("0022") || file.startsWith("0023") || file.startsWith("0025") || file.startsWith("0026") || file.startsWith("0027") || file.startsWith("0028") || file.startsWith("0029") || file.startsWith("0030") || file.startsWith("0032") || file.startsWith("0033")) {
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
      psql(readFileSync(path.join(MIGRATIONS, "0017_capture_review.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0019_capture_reprocess.sql"), "utf8"));
      // 0020 after 0013's re-run, on purpose: re-running 0013 recreates the old 9-arg
      // capture_complete_job and reverts capture_session_review to its pre-rationale
      // body. 0020 re-applied afterward drops that stale overload and re-establishes
      // the review read WITH per-frame observations, which the assertions below rely on.
      // 0021 then 0023 last so the provenance columns, the detail RPC, and the
      // assessment column + its apply extension all survive every re-run.
      psql(readFileSync(path.join(MIGRATIONS, "0020_observation_rationale.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0021_review_overrides.sql"), "utf8"));
      // 0022 MUST be re-applied here: re-running 0015's chain above reverts
      // capture_list_observations to its 9-column form and the review read to its
      // pre-assessment body, so 0022 re-establishes the GPS/rationale columns and
      // the per-segment assessment; 0023 last so the assessment column + its apply
      // extension survive every re-run.
      psql(readFileSync(path.join(MIGRATIONS, "0022_segment_synthesis.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0023_assessment_apply.sql"), "utf8"));
      // 0024 last so the contact column AND the contact-populating apply RPC survive
      // the re-run (0023 above reverts admin_apply_capture_session to its no-contact
      // body; 0024 re-establishes the session-sourced contact the assertions rely on).
      psql(readFileSync(path.join(MIGRATIONS, "0024_cv_observation_contact.sql"), "utf8"));
      // 0025..0027 last, and in order: re-running 0013/0017 above reverted the
      // claim/status/review bodies to plaintext-compare shapes. 0025 restores the
      // pipeline-truth semantics, 0026 restores the hashed-secret regime (its
      // UPDATE re-hashes only a plaintext row, so a second run is a no-op), and
      // 0027 re-establishes the composed truth the behavioral checks below assert.
      psql(readFileSync(path.join(MIGRATIONS, "0025_pipeline_truth.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0026_security_core.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0027_compose_pipeline_security.sql"), "utf8"));
      // 0028 last-but-one: re-running 0013 above flips streetlens-frames back to
      // public and drops the evidence SELECT / assessment_es wiring. Re-apply so
      // the privacy and bilingual schema the checks below assert actually stick.
      psql(readFileSync(path.join(MIGRATIONS, "0028_quality_privacy.sql"), "utf8"));
      // 0029 truly last: ops views read the post-0028 schema.
      psql(readFileSync(path.join(MIGRATIONS, "0029_ops_deck.sql"), "utf8"));
      // 0030 then 0032 after 0026's re-run restored the strict validator:
      // vehicle capture and glitch tolerance stay in force.
      psql(readFileSync(path.join(MIGRATIONS, "0030_vehicle_capture.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0031_testing_rate_relief.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0032_glitch_tolerant_track.sql"), "utf8"));
      psql(readFileSync(path.join(MIGRATIONS, "0033_frame_mime_relax.sql"), "utf8"));
      check("0013 + 0014 + 0017 + 0019 + 0020 + 0021 + 0022 + 0023 + 0024 are re-runnable (idempotent)", true);
    } catch (err) {
      check("0013 + 0014 + 0017 + 0019 + 0020 + 0021 + 0022 + 0023 + 0024 are re-runnable (idempotent)", false, String(err.stderr || err.message).slice(0, 800));
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

    const bucketPrivate = psql(`
      select (not public)::text from storage.buckets where id='streetlens-frames';
    `).trim();
    const bucketMeta = psql(`
      select file_size_limit::text || '|' || array_to_string(allowed_mime_types, ',')
        from storage.buckets where id='streetlens-frames';
    `).trim();
    check(
      "the frames bucket is private, 2 MB, jpeg-only (0028)",
      (bucketPrivate === "t" || bucketPrivate === "true") && bucketMeta === "2097152|image/jpeg",
      `${bucketPrivate}|${bucketMeta}`,
    );

    const storagePolicies = psql(`
      select string_agg(policyname || ':' || cmd, ',' order by policyname)
        from pg_policies
       where schemaname='storage' and tablename='objects'
         and policyname like 'capture_frames%';
    `).trim();
    check(
      "storage has INSERT + evidence SELECT, and no update/delete policy (0028)",
      storagePolicies === "capture_frames_anon_insert:INSERT,capture_frames_evidence_select:SELECT",
      storagePolicies,
    );

    /* ---------------- 0014 + 0026: submissions ---------------- */

    const SECRET = "test-secret";
    const seedSecret = () => {
      psql(`insert into app_secrets (key, value)
              values ('admin_rpc_secret', encode(digest('${SECRET}', 'sha256'), 'hex'))
              on conflict (key) do update set value = excluded.value;`);
    };
    seedSecret();

    check(
      "anon INSERT on submissions is blocked (0026)",
      psqlExpectError(`set role anon; insert into submissions (type, payload) values ('add_segment', '{}'::jsonb); reset role;`) !== null,
    );

    const subId = psql(`
      select submit_proposal('add_segment', '{}'::jsonb, 'pending', 'iphash-sub', false, '${SECRET}');
    `).trim();
    check("submit_proposal accepts add_segment with the server secret", /^[0-9a-f-]{36}$/.test(subId), subId);

    psql(`
      select submit_proposal('unknown', '{"rejected":"honeypot"}'::jsonb, 'rejected', 'iphash-bot', true, '${SECRET}');
    `);
    check("submit_proposal accepts unknown honeypot landings", true);

    check(
      "submit_proposal rejects a garbage type",
      (psqlExpectError(`select submit_proposal('nonsense', '{}'::jsonb, 'pending', 'iphash-x', false, '${SECRET}');`) || "").includes("invalid type"),
    );

    check(
      "submit_proposal without the secret is unauthorized",
      (psqlExpectError(`select submit_proposal('add_segment', '{}'::jsonb, 'pending', 'iphash-x', false, 'wrong');`) || "").includes("unauthorized"),
    );
    /* ---------------- RPCs: the public path ---------------- */

    const sid = psql(`select capture_create_session('live', 'iphash-a', 'me@example.com', '${SECRET}');`).trim();
    check("capture_create_session returns a session uuid", /^[0-9a-f-]{36}$/.test(sid), sid);
    check(
      "a new session starts at pending_upload",
      psql(`select status from capture_sessions where id='${sid}';`).trim() === "pending_upload",
    );
    check(
      "an invalid mode is rejected",
      psqlExpectError(`select capture_create_session('telepathy', 'iphash-z', null, '${SECRET}');`) !== null,
    );

    // Rate limit: 3/hour/IP, enforced in the DB (not just the in-memory bucket).
    // 0031 testing-era ceiling: 30/hour. Seed 30 sessions from one origin.
    psql(`do $$ begin for i in 1..30 loop perform capture_create_session('live', 'iphash-rl', null, '${SECRET}'); end loop; end $$;`);
    check(
      "a 31st session from one origin within the hour is rate_limited IN THE DATABASE (0031)",
      (psqlExpectError(`select capture_create_session('live', 'iphash-rl', null, '${SECRET}');`) || "").includes("rate_limited"),
    );
    check(
      "the ceiling is per-origin: a different ip hash is unaffected",
      /^[0-9a-f-]{36}$/.test(psql(`select capture_create_session('live', 'iphash-other', null, '${SECRET}');`).trim()),
    );

    const accepted = psql(`
      select capture_register_frames('${sid}'::uuid,
        '[{"seq":0,"t":1784000000000,"width":1920,"height":1080,"bytes":500000},
          {"seq":1,"t":1784000001000,"width":1920,"height":1080,"bytes":500000}]'::jsonb, '${SECRET}');
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
      const s2 = psql(`select capture_create_session('live', 'iphash-b', null, '${SECRET}');`).trim();
      psql(`select capture_register_frames('${s2}'::uuid,
        '[{"seq":0,"t":1784000000000,"width":10,"height":10,"bytes":10,"storagePath":"captures/evil/../../secret.jpg"}]'::jsonb, '${SECRET}');`);
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
          '[{"seq":0,"t":1784000000000,"width":1920,"height":1080,"bytes":500000}]'::jsonb, '${SECRET}');
      `).trim() === "{0,1}" &&
        psql(`select count(*) from capture_frames where session_id='${sid}';`).trim() === "2",
    );
    check(
      "an oversized frame is rejected by the CHECK",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":5,"t":1784000000000,"width":1920,"height":1080,"bytes":9999999}]'::jsonb, '${SECRET}');`) !== null,
    );
    check(
      "seq >= 400 is rejected by the CHECK",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":400,"t":1784000000000,"width":1920,"height":1080,"bytes":100}]'::jsonb, '${SECRET}');`) !== null,
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
        '[{"lat":9.907,"lng":-84.152,"t":1784000000000},{"lat":9.907,"lng":-84.150,"t":1784000030000}]'::jsonb, 250, '${SECRET}');
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
      psqlExpectError(`select capture_finalize_session('${sid}'::uuid, '[{"lat":9,"lng":-84,"t":1},{"lat":9.1,"lng":-84.1,"t":2}]'::jsonb, 0, '${SECRET}');`) !== null,
    );
    check(
      "a finalized session no longer accepts frames",
      psqlExpectError(`select capture_register_frames('${sid}'::uuid,
        '[{"seq":9,"t":1784000000000,"width":10,"height":10,"bytes":10}]'::jsonb, '${SECRET}');`) !== null,
    );


    check(
      "capture_create_session without the secret is unauthorized",
      (psqlExpectError(`select capture_create_session('live', 'iphash-nosec', null, 'wrong');`) || "").includes("unauthorized"),
    );
    check(
      "capture_create_session with a null ip hash is rate_limited",
      (psqlExpectError(`select capture_create_session('live', null, null, '${SECRET}');`) || "").includes("rate_limited"),
    );
    check(
      "capture_finalize_session rejects an out-of-bbox track",
      (psqlExpectError(`select capture_finalize_session('${sid}'::uuid, '[{"lat":0,"lng":0,"t":1},{"lat":1,"lng":1,"t":2}]'::jsonb, 0, '${SECRET}');`) || "").includes("invalid_track"),
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
            '{"sidewalk_present":{"value":1,"confidence":0.9}}'::jsonb, true, 0.87, 1200, 300, false,
            'Narrow paved street, no sidewalk either side; open gutter at the right edge.', 'test-secret');`);
    check(
      "capture_complete_job stores the observation and closes the job",
      psql(`select count(*) from capture_observations where frame_id='${frameId}';`).trim() === "1" &&
        psql(`select status from capture_frame_jobs where frame_id='${frameId}';`).trim() === "done",
    );
    check(
      "capture_complete_job persists the per-frame rationale (0020)",
      psql(`select rationale from capture_observations where frame_id='${frameId}' and model='gpt-5-mini';`).trim() ===
        "Narrow paved street, no sidewalk either side; open gutter at the right edge.",
    );
    psql(`select capture_complete_job('${frameId}'::uuid, 'gpt-5-mini',
            '{"sidewalk_present":{"value":0,"confidence":0.4}}'::jsonb, true, 0.4, 1200, 300, false,
            'On second look the gutter is silted but present.', 'test-secret');`);
    check(
      "re-running one model REPLACES its answer rather than double-counting",
      psql(`select count(*) from capture_observations where frame_id='${frameId}';`).trim() === "1",
    );
    check(
      "the re-run overwrites the rationale too, not just the items",
      psql(`select rationale from capture_observations where frame_id='${frameId}' and model='gpt-5-mini';`).trim() ===
        "On second look the gutter is silted but present.",
    );
    psql(`select capture_complete_job('${frameId}'::uuid, 'gpt-5',
            '{"sidewalk_present":{"value":1,"confidence":0.99}}'::jsonb, true, 0.99, 2000, 400, true,
            'Escalated read: clearly a two-lane street with intact gutters.', 'test-secret');`);
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

    /* ---------------- 0020: per-frame observation on the review read ---------------- */
    // sid now has seq 0 scored twice (gpt-5-mini, then escalated gpt-5) and seq 1
    // never scored (failed_overbudget). The FROZEN CONTRACT hangs an `observation`
    // off every frame: the winning row for a scored frame, null for an unscored one.
    {
      const rv = JSON.parse(psql(`select capture_session_review('${sid}'::uuid, 'test-secret');`).trim());
      const bySeq = Object.fromEntries((rv.frames ?? []).map((f) => [f.seq, f]));
      const scored = bySeq[0];
      const unscored = bySeq[1];
      check(
        "a scored frame carries observation { items, rationale, escalated, model }",
        scored && scored.observation &&
          typeof scored.observation.items === "object" &&
          typeof scored.observation.rationale === "string" &&
          typeof scored.observation.escalated === "boolean" &&
          typeof scored.observation.model === "string",
        JSON.stringify(scored && scored.observation),
      );
      check(
        "the escalated row wins the frame's observation, with its rationale",
        scored && scored.observation &&
          scored.observation.escalated === true &&
          scored.observation.model === "gpt-5" &&
          scored.observation.rationale === "Escalated read: clearly a two-lane street with intact gutters.",
        JSON.stringify(scored && scored.observation),
      );
      check(
        "an unscored/failed frame reports observation: null (not an empty object)",
        unscored !== undefined && unscored.observation === null,
        JSON.stringify(unscored),
      );
    }

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

    /* ---------------- 0022: segment synthesis assessment ---------------- */
    {
      check(
        "capture_segment_rollups gains an assessment jsonb column",
        psql(`select data_type from information_schema.columns
                where table_name='capture_segment_rollups' and column_name='assessment';`).trim() === "jsonb",
      );
      check(
        "capture_segment_rollups gains the two synthesis token columns",
        psql(`select count(*) from information_schema.columns
                where table_name='capture_segment_rollups'
                  and column_name in ('synthesis_input_tokens','synthesis_output_tokens');`).trim() === "2",
      );

      // esc-sa-0001 already has a rollup row (written above); attach an assessment.
      const assessment = JSON.stringify({
        overall: "Sidewalk vanishes halfway along the block.",
        lenses: { accessibility: "a", drainage: "d", shade: "s", bike: "b" },
        adjustments: { accessibility: { delta: -12, reason: "sidewalk disappears for 200 m" } },
        adjustedScores: { overall: 41, accessibility: 38, drainage: null, shade: 55, bike: null },
        model: "gpt-5.4-mini",
      });
      psql(`select capture_set_segment_assessment('${sid}'::uuid, 'esc-sa-0001',
              '${assessment}'::jsonb, 512, 210, 'test-secret', null::jsonb);`);
      check(
        "capture_set_segment_assessment writes the assessment onto the rollup",
        psql(`select assessment->>'model' from capture_segment_rollups
                where session_id='${sid}' and segment_id='esc-sa-0001';`).trim() === "gpt-5.4-mini",
      );
      check(
        "and records the synthesis token spend for the ledger",
        psql(`select (synthesis_input_tokens=512 and synthesis_output_tokens=210)::text
                from capture_segment_rollups where session_id='${sid}' and segment_id='esc-sa-0001';`).trim() === "true",
      );
      const assessmentEs = JSON.stringify({
        overall: "La acera desaparece a mitad de cuadra.",
        lenses: { accessibility: "a", drainage: "d", shade: "s", bike: "b" },
      });
      psql(`select capture_set_segment_assessment('${sid}'::uuid, 'esc-sa-0001',
              '${assessment}'::jsonb, 512, 210, 'test-secret', '${assessmentEs}'::jsonb);`);
      check(
        "capture_set_segment_assessment writes assessment_es alongside EN",
        psql(`select assessment_es->>'overall' from capture_segment_rollups
                where session_id='${sid}' and segment_id='esc-sa-0001';`).trim() ===
          "La acera desaparece a mitad de cuadra.",
      );
      check(
        "capture_set_segment_assessment is secret-gated",
        (psqlExpectError(`select capture_set_segment_assessment('${sid}'::uuid, 'esc-sa-0001', '{}'::jsonb, 0, 0, 'nope', null::jsonb);`) || "").includes("unauthorized"),
      );
      check(
        "writing an assessment for an absent segment is a no-op, not an orphan row",
        (() => {
          psql(`select capture_set_segment_assessment('${sid}'::uuid, 'no-such-seg', '{}'::jsonb, 0, 0, 'test-secret', null::jsonb);`);
          return psql(`select count(*) from capture_segment_rollups
                         where session_id='${sid}' and segment_id='no-such-seg';`).trim() === "0";
        })(),
      );

      // The review read hangs the assessment off the rollup and sums synthesis spend.
      const rv = JSON.parse(psql(`select capture_session_review('${sid}'::uuid, 'test-secret');`).trim());
      const seg = (rv.rollups ?? []).find((r) => r.segmentId === "esc-sa-0001");
      check(
        "capture_session_review carries the per-segment assessment verbatim",
        seg && seg.assessment && seg.assessment.model === "gpt-5.4-mini" &&
          seg.assessment.adjustedScores.accessibility === 38,
        JSON.stringify(seg && seg.assessment),
      );
      check(
        "the review tokens block sums synthesis spend beside the vision spend",
        rv.tokens.synthesisInputTokens === 512 && rv.tokens.synthesisOutputTokens === 210,
        JSON.stringify(rv.tokens),
      );

      // capture_list_observations now returns each frame's rationale and GPS.
      check(
        "capture_list_observations returns the per-frame rationale (0022)",
        psql(`select bool_or(rationale = 'Escalated read: clearly a two-lane street with intact gutters.')::text
                from capture_list_observations('${sid}'::uuid, 'test-secret') where seq=0;`).trim() === "true",
      );
      check(
        "capture_list_observations exposes lng/lat columns for synthesis distance",
        psqlExpectError(`select lng, lat from capture_list_observations('${sid}'::uuid, 'test-secret') limit 1;`) === null,
      );
    }

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

    /* ---------------- 0017: the review loop (u30) ---------------- */

    // The emit. Idempotency here is not a nicety: the pump files a session BEFORE
    // flipping it to review_ready (that write is a one-way latch), so a crash in
    // between re-emits on the next pump. That retry is only safe if a second emit
    // is a no-op, and TS cannot dedupe it — 0006 gives anon INSERT on submissions
    // and no SELECT policy, so the check has to live in here.
    // A contact on this session, so the apply can prove contact is published from
    // the SESSION (server-side, 0024) rather than from the observation payload.
    const cvSid = psql(`select capture_create_session('live', 'iphash-cv', 'walker@example.org', '${SECRET}');`).trim();
    check(
      "capture_emit_submission is secret-gated",
      (psqlExpectError(`select capture_emit_submission('${cvSid}'::uuid, 'nope');`) || "").includes("unauthorized"),
    );
    check(
      "emitting for a session that does not exist raises",
      psqlExpectError(
        `select capture_emit_submission('00000000-0000-0000-0000-000000000000'::uuid, 'test-secret');`,
      ) !== null,
    );
    psql(`select capture_emit_submission('${cvSid}'::uuid, 'test-secret');`);
    check(
      "the drained session is filed as a pending cv_capture row",
      psql(`select count(*) from submissions
             where type='cv_capture' and payload->>'session_id'='${cvSid}' and status='pending';`).trim() === "1",
    );
    psql(`select capture_emit_submission('${cvSid}'::uuid, 'test-secret');`);
    psql(`select capture_emit_submission('${cvSid}'::uuid, 'test-secret');`);
    check(
      "re-emitting is a no-op, so the pump's retry cannot double-file the walk",
      psql(`select count(*) from submissions
             where type='cv_capture' and payload->>'session_id'='${cvSid}';`).trim() === "1",
    );

    const cvSub = psql(`select id from submissions
                         where type='cv_capture' and payload->>'session_id'='${cvSid}';`).trim();

    // The admin review read. It is separate from capture_session_status (0013)
    // rather than a widening of it, because that one is PUBLIC — the session uuid
    // is its only capability — and this one returns token spend.
    check(
      "capture_session_review is secret-gated",
      (psqlExpectError(`select capture_session_review('${cvSid}'::uuid, 'nope');`) || "").includes("unauthorized"),
    );
    const reviewJson = psql(`select capture_session_review('${cvSid}'::uuid, 'test-secret');`).trim();
    const review = JSON.parse(reviewJson);
    check(
      "the review read returns the session shape the page needs",
      review.sessionId === cvSid &&
        typeof review.status === "string" &&
        review.jobs !== undefined &&
        review.tokens !== undefined &&
        Array.isArray(review.rollups) &&
        Array.isArray(review.frames),
      reviewJson.slice(0, 160),
    );
    check(
      "overbudget is reported separately from failed (money out != frame bad)",
      review.jobs.overbudget !== undefined && review.jobs.failed !== undefined,
      JSON.stringify(review.jobs),
    );
    check(
      "the review read reports token spend (which the PUBLIC status must not)",
      typeof review.tokens.inputTokens === "number" || review.tokens.inputTokens !== undefined,
      JSON.stringify(review.tokens),
    );
    check(
      "an unknown session raises rather than returning null",
      psqlExpectError(
        `select capture_session_review('00000000-0000-0000-0000-000000000000'::uuid, 'test-secret');`,
      ) !== null,
    );

    // The apply. Two segments approved out of a walk.
    const obs = (ids) =>
      JSON.stringify(
        ids.map((s) => ({
          id: `cv-${cvSid}-${s}`,
          segment_id: s,
          scores: { overall: 61.5, accessibility: 40, drainage: null, shade: 55, bike: null },
          item_medians: { ramp_present: { value: 0.5, confidence: 0.8, frames: 3 } },
          coverage: 0.75,
          confidence: 0.62,
          frame_refs: [`captures/${cvSid}/frame-0000.jpg`],
          captured_on: "2026-07-16T10:00:00Z",
        })),
      ).replace(/'/g, "''");

    check(
      "admin_apply_capture_session is secret-gated",
      (psqlExpectError(
        `select admin_apply_capture_session('nope', '${cvSid}'::uuid, null, '${obs(["seg-a"])}'::jsonb);`,
      ) || "").includes("unauthorized"),
    );
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${obs(["seg-a", "seg-b"])}'::jsonb);`);
    check(
      "approving two segments lands exactly two observations",
      psql(`select count(*) from community_cv_observations where session_id='${cvSid}';`).trim() === "2",
    );
    check(
      "a lens no frame supported stays NULL rather than becoming a zero",
      psql(`select coalesce(score_drainage::text,'NULL') || '|' || score_accessibility::text
              from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "NULL|40.00",
    );
    check(
      "the observation keeps its provenance and capture date",
      psql(`select (submission_id='${cvSub}')::text || '|' || (captured_on is not null)::text
              from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "true|true",
    );
    // The public observation table must NEVER carry contact (conductor privacy rule).
    check(
      "community_cv_observations has NO contact column (contact stays admin-only)",
      psql(`select count(*) from information_schema.columns
             where table_name='community_cv_observations' and column_name='contact';`).trim() === "0",
    );
    // Contact reaches an admin ONLY via the secret-gated detail RPC (0024), never
    // the anon-callable review RPC.
    check(
      "the ADMIN detail RPC surfaces contact for the reviewer (0024)",
      JSON.parse(psql(`select capture_session_review_detail('${cvSid}'::uuid, 'test-secret');`).trim()).contact === "walker@example.org",
    );
    check(
      "the anon review RPC still withholds contact",
      !psql(`select capture_session_review('${cvSid}'::uuid, 'test-secret');`).includes("walker@example.org"),
    );

    // Re-approving with one segment unticked. Upsert alone would leave seg-b
    // published forever — an admin who retracts a segment must see it go.
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${obs(["seg-a"])}'::jsonb);`);
    check(
      "re-approving is idempotent for the segments that stayed ticked",
      psql(`select count(*) from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "1",
    );
    check(
      "an UNTICKED segment is retracted, not left published",
      psql(`select count(*) from community_cv_observations where id='cv-${cvSid}-seg-b';`).trim() === "0",
    );
    check(
      "retraction is scoped to its own session",
      psql(`select count(*) from community_cv_observations where session_id='${cvSid}';`).trim() === "1",
    );
    check(
      "an out-of-range CV score is rejected by the CHECK",
      psqlExpectError(`insert into community_cv_observations (id, segment_id, session_id, score_overall)
                       values ('cv-bad', 'seg-a', '${cvSid}'::uuid, 140);`) !== null,
    );
    check(
      "approving a capture NEVER writes an audit (the prime invariant)",
      psql(`select (select count(*) from audits)::text || '|' || (select count(*) from observations)::text;`).trim() === "0|0",
    );

    /* ---------------- 0021: reviewer-override provenance ---------------- */

    // Re-approve seg-a as a human-corrected row: the compact overrides record and
    // the human_corrected flag must land verbatim, and the map reads them back.
    const corrected = JSON.stringify([
      {
        id: `cv-${cvSid}-seg-a`,
        segment_id: "seg-a",
        scores: { overall: 50, accessibility: 40, drainage: null, shade: 55, bike: null },
        item_medians: { ramp_present: { value: 0.5, confidence: 0.8, frames: 2 } },
        coverage: 0.5,
        confidence: 0.6,
        frame_refs: [`captures/${cvSid}/frame-0000.jpg`],
        captured_on: "2026-07-16T10:00:00Z",
        human_corrected: true,
        overrides: {
          items: { 0: { surface_condition: 0 } },
          excludedSeqs: [2],
          deletedSeqs: [],
          scores: { overall: 50 },
        },
      },
    ]).replace(/'/g, "''");
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${corrected}'::jsonb);`);
    check(
      "a human-corrected approval persists human_corrected = true",
      psql(`select human_corrected::text from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "true",
    );
    check(
      "the compact overrides record round-trips verbatim",
      psql(`select ((overrides->'excludedSeqs' = '[2]'::jsonb)
              and (overrides->'items'->'0'->>'surface_condition' = '0')
              and (overrides->'scores'->>'overall' = '50'))::text
              from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "true",
    );
    // Backward compatibility: a payload with neither field resets to the untouched
    // defaults, so an un-upgraded caller (or a re-approval of a fixed row) still works.
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${obs(["seg-a"])}'::jsonb);`);
    check(
      "a payload with no provenance fields defaults to human_corrected = false, overrides = {}",
      psql(`select human_corrected::text || '|' || (overrides = '{}'::jsonb)::text
              from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "false|true",
    );

    /* ---------------- 0023: segment synthesis (assessment) ---------------- */

    // The row above was just re-applied with no assessment: it must read NULL, so a
    // walk with no synthesis (or an un-upgraded caller) is honestly "no assessment".
    check(
      "a payload with no assessment leaves the column NULL",
      psql(`select coalesce(assessment::text, 'NULL') from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "NULL",
    );

    // Re-approve seg-a carrying a synthesis: the whole object must round-trip, and
    // the overall text (what the public popover shows) must land verbatim.
    const withAssessment = JSON.stringify([
      {
        id: `cv-${cvSid}-seg-a`,
        segment_id: "seg-a",
        scores: { overall: 58, accessibility: 40, drainage: null, shade: 55, bike: null },
        item_medians: { ramp_present: { value: 0.5, confidence: 0.8, frames: 2 } },
        coverage: 0.5,
        confidence: 0.6,
        frame_refs: [`captures/${cvSid}/frame-0000.jpg`],
        captured_on: "2026-07-16T10:00:00Z",
        assessment: {
          overall: "A generally walkable block; the missing curb ramp is the one real gap.",
          lenses: {
            accessibility: "Sidewalk continuous but no ramp at the north corner.",
            drainage: "No standing water seen.",
            shade: "Partial canopy at midday.",
            bike: "No dedicated bike provision.",
          },
          adjustments: { accessibility: { delta: -6, reason: "Missing curb ramp weighs the lens down." } },
          adjustedScores: { overall: 55, accessibility: 34, drainage: null, shade: 55, bike: null },
          model: "gpt-5",
        },
      },
    ]).replace(/'/g, "''");
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${withAssessment}'::jsonb);`);
    check(
      "the assessment overall text round-trips verbatim",
      psql(`select assessment->>'overall' from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() ===
        "A generally walkable block; the missing curb ramp is the one real gap.",
    );
    check(
      "the assessment's per-lens explanation and adjustment delta round-trip",
      psql(`select ((assessment->'lenses'->>'accessibility' = 'Sidewalk continuous but no ramp at the north corner.')
              and (assessment->'adjustments'->'accessibility'->>'delta' = '-6')
              and (assessment->>'model' = 'gpt-5'))::text
              from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "true",
    );
    check(
      "the reviewer's chosen NUMBERS still land, not the synthesis's adjustedScores",
      psql(`select score_accessibility::text from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "40.00",
    );
    // Backward compatibility: re-approving with no assessment resets it to NULL, so a
    // later un-upgraded caller (or a walk whose synthesis was dropped) is honest.
    psql(`select admin_apply_capture_session('test-secret', '${cvSid}'::uuid, '${cvSub}'::uuid, '${obs(["seg-a"])}'::jsonb);`);
    check(
      "re-approving with no assessment resets the column to NULL",
      psql(`select coalesce(assessment::text, 'NULL') from community_cv_observations where id='cv-${cvSid}-seg-a';`).trim() === "NULL",
    );

    // Closing the review: session and queue row move together or not at all.
    check(
      "capture_close_review is secret-gated",
      (psqlExpectError(`select capture_close_review('${cvSid}'::uuid, 'approve', 'looks right', 'nope');`) || "").includes("unauthorized"),
    );
    check(
      "a reason is mandatory, in the database and not just the UI",
      psqlExpectError(`select capture_close_review('${cvSid}'::uuid, 'approve', '   ', 'test-secret');`) !== null,
    );
    check(
      "an invalid action is rejected",
      psqlExpectError(`select capture_close_review('${cvSid}'::uuid, 'maybe', 'hmm', 'test-secret');`) !== null,
    );
    psql(`select capture_close_review('${cvSid}'::uuid, 'approve', 'two segments look right', 'test-secret');`);
    check(
      "closing stamps the session AND closes its queue row in one go",
      psql(`select
              (select status from capture_sessions where id='${cvSid}') || '|' ||
              (select (reviewed_at is not null)::text from capture_sessions where id='${cvSid}') || '|' ||
              (select status from submissions where id='${cvSub}') || '|' ||
              (select reviewer_note from submissions where id='${cvSub}');`).trim()
        === "approved|true|approved|two segments look right",
    );

    // The session-scoped claim. This is what lets a contributor's status page
    // pump WITHOUT the admin secret, so its scoping is a security property.
    const otherSid = psql(`select capture_create_session('live', 'iphash-other-cv', null, '${SECRET}');`).trim();
    psql(`
      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id)
      values ('${otherSid}'::uuid, 0, 'captures/${otherSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, 'seg-z');
      insert into capture_frame_jobs (frame_id)
        select id from capture_frames where session_id='${otherSid}'::uuid;
      update capture_sessions set status='extracting' where id='${otherSid}'::uuid;
    `);
    check(
      "capture_claim_jobs_for_session is secret-gated",
      (psqlExpectError(`select * from capture_claim_jobs_for_session('${otherSid}'::uuid, 5, 'nope');`) || "").includes("unauthorized"),
    );
    const mineSid = psql(`select capture_create_session('live', 'iphash-mine-cv', null, '${SECRET}');`).trim();
    psql(`
      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id)
      values ('${mineSid}'::uuid, 0, 'captures/${mineSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, 'seg-y');
      insert into capture_frame_jobs (frame_id)
        select id from capture_frames where session_id='${mineSid}'::uuid;
      update capture_sessions set status='extracting' where id='${mineSid}'::uuid;
    `);
    const claimedForMine = psql(
      `select count(*) from capture_claim_jobs_for_session('${mineSid}'::uuid, 5, 'test-secret');`,
    ).trim();
    check(
      "the scoped claim takes MY session's job",
      claimedForMine === "1",
      `claimed=${claimedForMine}`,
    );
    check(
      "and it CANNOT reach another session's frames — the whole point of the route",
      psql(`select status from capture_frame_jobs j
             join capture_frames f on f.id=j.frame_id
             where f.session_id='${otherSid}'::uuid;`).trim() === "pending",
    );
    check(
      "a cost_paused session is not claimable, so polling cannot resurrect it",
      (() => {
        psql(`update capture_sessions set status='cost_paused' where id='${otherSid}'::uuid;`);
        return psql(`select count(*) from capture_claim_jobs_for_session('${otherSid}'::uuid, 5, 'test-secret');`).trim() === "0";
      })(),
    );

    /* ---------------- 0019: the reprocess loop (canton expansion) ---------------- */

    // The motivating case: a walk finished OFF the network, so every frame failed
    // no_segment_match and the session drained to review_ready with nothing scored.
    // An expansion later puts streets under it; reprocess re-matches the stored
    // track and re-queues only the frames that now land. This block builds that
    // session by hand — six frames in the states reprocess must tell apart.
    const rpSid = psql(`select capture_create_session('live', 'iphash-reproc', null, '${SECRET}');`).trim();
    psql(`
      update capture_sessions
         set track = st_geogfromtext('SRID=4326;LINESTRING(-84.152 9.907, -84.150 9.907, -84.148 9.907)'),
             frame_count = 6,
             status = 'review_ready'
       where id = '${rpSid}'::uuid;

      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id) values
        ('${rpSid}'::uuid, 0, 'captures/${rpSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, null),
        ('${rpSid}'::uuid, 1, 'captures/${rpSid}/frame-0001.jpg', 1784000002000, 640, 480, 1000, null),
        ('${rpSid}'::uuid, 2, 'captures/${rpSid}/frame-0002.jpg', 1784000004000, 640, 480, 1000, null),
        ('${rpSid}'::uuid, 3, 'captures/${rpSid}/frame-0003.jpg', 1784000006000, 640, 480, 1000, 'seg-done'),
        ('${rpSid}'::uuid, 4, 'captures/${rpSid}/frame-0004.jpg', 1784000008000, 640, 480, 1000, null),
        ('${rpSid}'::uuid, 5, 'captures/${rpSid}/frame-0005.jpg', 1784000010000, 640, 480, 1000, null);

      insert into capture_frame_jobs (frame_id) select id from capture_frames where session_id='${rpSid}'::uuid;

      -- seq 0,1,2: the off-network casualties (failed no_segment_match).
      update capture_frame_jobs j set status='failed', error='no_segment_match'
        from capture_frames f where f.id=j.frame_id and f.session_id='${rpSid}'::uuid and f.seq in (0,1,2);
      -- seq 3: already extracted (done) — its provenance must survive untouched.
      update capture_frame_jobs j set status='done', error=null
        from capture_frames f where f.id=j.frame_id and f.session_id='${rpSid}'::uuid and f.seq=3;
      -- seq 4: budget breaker's business, not a matching failure.
      update capture_frame_jobs j set status='failed_overbudget', error='budget exhausted'
        from capture_frames f where f.id=j.frame_id and f.session_id='${rpSid}'::uuid and f.seq=4;
      -- seq 5: a model failure, not a matching one.
      update capture_frame_jobs j set status='failed', error='model boom'
        from capture_frames f where f.id=j.frame_id and f.session_id='${rpSid}'::uuid and f.seq=5;
    `);

    // capture_session_track: the read the script re-matches from.
    check(
      "capture_session_track is secret-gated",
      (psqlExpectError(`select capture_session_track('${rpSid}'::uuid, 'nope');`) || "").includes("unauthorized"),
    );
    const trackJson = psql(`select capture_session_track('${rpSid}'::uuid, 'test-secret');`).trim();
    const trackRead = JSON.parse(trackJson);
    check(
      "capture_session_track returns status + the ordered track vertices",
      trackRead.status === "review_ready" &&
        Array.isArray(trackRead.track) &&
        trackRead.track.length === 3 &&
        Math.abs(trackRead.track[0].lng - -84.152) < 1e-6 &&
        Math.abs(trackRead.track[0].lat - 9.907) < 1e-6,
      trackJson.slice(0, 160),
    );
    check(
      "capture_session_track raises on an unknown session",
      psqlExpectError(`select capture_session_track('00000000-0000-0000-0000-000000000000'::uuid, 'test-secret');`) !== null,
    );

    // The reprocess payload the script would hand over: the whole frame set,
    // with seq 0,1 now landing on a newly-present street and seq 2 still off it.
    const rpPayload = JSON.stringify([
      { seq: 0, segmentId: "seg-new", nearJunction: false },
      { seq: 1, segmentId: "seg-new", nearJunction: true },
      { seq: 2, segmentId: null, nearJunction: false },
      { seq: 3, segmentId: "seg-done", nearJunction: false },
      { seq: 4, segmentId: null, nearJunction: false },
      { seq: 5, segmentId: null, nearJunction: false },
    ]).replace(/'/g, "''");

    check(
      "capture_reprocess_session is secret-gated",
      (psqlExpectError(`select capture_reprocess_session('${rpSid}'::uuid, '${rpPayload}'::jsonb, 'nope');`) || "").includes("unauthorized"),
    );

    const rpResult = JSON.parse(psql(`select capture_reprocess_session('${rpSid}'::uuid, '${rpPayload}'::jsonb, 'test-secret');`).trim());
    check(
      "reprocess touches only the three no_segment_match frames",
      rpResult.reprocessed === 3,
      JSON.stringify(rpResult),
    );
    check(
      "it re-queues the two that now match and reports the one still off-network",
      rpResult.requeued === 2 && rpResult.matchedNow === 2 && rpResult.stillUnmatched === 1 && rpResult.noop === false,
      JSON.stringify(rpResult),
    );
    check(
      "a review_ready session with fresh work flips back to extracting",
      rpResult.status === "extracting" &&
        psql(`select status from capture_sessions where id='${rpSid}'::uuid;`).trim() === "extracting",
    );
    check(
      "the now-matched frames are pending again with the error cleared",
      psql(`select string_agg(j.status || ':' || coalesce(j.error,'-'), ',' order by f.seq)
               from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq in (0,1);`).trim() === "pending:-,pending:-",
    );
    check(
      "and they carry the new segment attribution",
      psql(`select string_agg(segment_id, ',' order by seq) from capture_frames
              where session_id='${rpSid}'::uuid and seq in (0,1);`).trim() === "seg-new,seg-new" &&
        psql(`select near_junction::text from capture_frames where session_id='${rpSid}'::uuid and seq=1;`).trim() === "true",
    );
    check(
      "a frame still off-network stays failed no_segment_match, so the session can still drain",
      psql(`select j.status || ':' || j.error from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq=2;`).trim() === "failed:no_segment_match",
    );
    check(
      "an already-extracted (done) frame keeps its job AND its segment provenance",
      psql(`select j.status from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq=3;`).trim() === "done" &&
        psql(`select segment_id from capture_frames where session_id='${rpSid}'::uuid and seq=3;`).trim() === "seg-done",
    );
    check(
      "a failed_overbudget job is NOT silently retried",
      psql(`select j.status from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq=4;`).trim() === "failed_overbudget",
    );
    check(
      "a model-error failed job (not a matching failure) is left alone",
      psql(`select j.status || ':' || j.error from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq=5;`).trim() === "failed:model boom",
    );

    // Idempotency: the same payload again. seq 0,1 are pending now (no longer
    // no_segment_match), so only seq 2 is a target, it still does not match, and
    // nothing changes — the second run is a clean no-op.
    const rpAgain = JSON.parse(psql(`select capture_reprocess_session('${rpSid}'::uuid, '${rpPayload}'::jsonb, 'test-secret');`).trim());
    check(
      "a re-run only reconsiders the still-unmatched frame and changes nothing",
      rpAgain.reprocessed === 1 && rpAgain.requeued === 0 && rpAgain.noop === true && rpAgain.status === "extracting",
      JSON.stringify(rpAgain),
    );
    check(
      "the re-queued frames are untouched by the idempotent re-run (still pending)",
      psql(`select count(*) from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
              where f.session_id='${rpSid}'::uuid and f.seq in (0,1) and j.status='pending';`).trim() === "2",
    );

    // Guard rails.
    check(
      "reprocess refuses a payload that names a frame not in the session",
      psqlExpectError(`select capture_reprocess_session('${rpSid}'::uuid,
        '[{"seq":99,"segmentId":"seg-x"}]'::jsonb, 'test-secret');`) !== null,
    );
    {
      const decided = psql(`select capture_create_session('live', 'iphash-decided', null, '${SECRET}');`).trim();
      psql(`update capture_sessions set status='approved' where id='${decided}'::uuid;`);
      check(
        "reprocess refuses a decided (approved) session — history, not a retry target",
        (psqlExpectError(`select capture_reprocess_session('${decided}'::uuid, '[]'::jsonb, 'test-secret');`) || "").includes("already decided"),
      );
      psql(`update capture_sessions set status='rejected' where id='${decided}'::uuid;`);
      check(
        "reprocess refuses a rejected session too",
        (psqlExpectError(`select capture_reprocess_session('${decided}'::uuid, '[]'::jsonb, 'test-secret');`) || "").includes("already decided"),
      );
      psql(`update capture_sessions set status='cost_paused' where id='${decided}'::uuid;`);
      check(
        "reprocess refuses a session that is not extracting/review_ready (e.g. cost_paused)",
        (psqlExpectError(`select capture_reprocess_session('${decided}'::uuid, '[]'::jsonb, 'test-secret');`) || "").includes("not reprocessable"),
      );
    }

    /* ---------------- 0021: frame delete + review detail ---------------- */

    // A hand-built walk: two matched frames (one at a junction, one usable, one
    // not), one unmatched frame with no location. seq 0 carries two observations —
    // it escalated — so the detail read must report the STRONGER model's usable.
    const dSid = psql(`select capture_create_session('live', 'iphash-del', null, '${SECRET}');`).trim();
    psql(`
      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id, near_junction, location) values
        ('${dSid}'::uuid, 0, 'captures/${dSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, 'seg-x', false,
           st_geogfromtext('SRID=4326;POINT(-84.150 9.9070)')),
        ('${dSid}'::uuid, 1, 'captures/${dSid}/frame-0001.jpg', 1784000002000, 640, 480, 1000, 'seg-x', true,
           st_geogfromtext('SRID=4326;POINT(-84.149 9.9071)')),
        ('${dSid}'::uuid, 2, 'captures/${dSid}/frame-0002.jpg', 1784000004000, 640, 480, 1000, null, false, null);

      insert into capture_observations (frame_id, segment_id, model, items, usable, escalated)
        select id, 'seg-x', 'gpt-5-nano', '{}'::jsonb, true, false from capture_frames where session_id='${dSid}'::uuid and seq=0;
      insert into capture_observations (frame_id, segment_id, model, items, usable, escalated)
        select id, 'seg-x', 'gpt-5', '{}'::jsonb, false, true from capture_frames where session_id='${dSid}'::uuid and seq=0;
      insert into capture_observations (frame_id, segment_id, model, items, usable, escalated)
        select id, 'seg-x', 'gpt-5-nano', '{}'::jsonb, false, false from capture_frames where session_id='${dSid}'::uuid and seq=1;

      insert into storage.objects (bucket_id, name) values ('streetlens-frames', 'captures/${dSid}/frame-0000.jpg');
    `);

    check(
      "capture_session_review_detail is secret-gated",
      (psqlExpectError(`select capture_session_review_detail('${dSid}'::uuid, 'nope');`) || "").includes("unauthorized"),
    );
    const detail = JSON.parse(psql(`select capture_session_review_detail('${dSid}'::uuid, 'test-secret');`).trim());
    check(
      "detail returns a frame per capture frame, in seq order, with geography + quality",
      Array.isArray(detail.frames) && detail.frames.length === 3 &&
        detail.frames[0].seq === 0 && detail.frames[1].seq === 1 && detail.frames[2].seq === 2,
      JSON.stringify(detail.frames),
    );
    check(
      "a matched frame carries its ground position; an unmatched one carries null",
      detail.frames[0].position && Math.abs(detail.frames[0].position.lng - -84.15) < 1e-6 &&
        detail.frames[2].position === null,
      JSON.stringify(detail.frames.map((f) => f.position)),
    );
    check(
      "near_junction rides through per frame",
      detail.frames[0].nearJunction === false && detail.frames[1].nearJunction === true,
    );
    check(
      "usable comes from the winning (escalated) observation, matching the rollup",
      detail.frames[0].usable === false && detail.frames[1].usable === false,
      JSON.stringify(detail.frames.map((f) => f.usable)),
    );
    check(
      "a session with no finalized track returns an empty track and no tombstones",
      Array.isArray(detail.track) && detail.track.length === 0 &&
        Array.isArray(detail.tombstones) && detail.tombstones.length === 0,
    );

    check(
      "capture_delete_frame is secret-gated",
      (psqlExpectError(`select capture_delete_frame('nope', '${dSid}'::uuid, 0);`) || "").includes("unauthorized"),
    );
    const delRes = JSON.parse(psql(`select capture_delete_frame('test-secret', '${dSid}'::uuid, 0);`).trim());
    check(
      "deleting a frame reports the bytes were removed",
      delRes.deleted === true && delRes.seq === 0 && delRes.bytesRemoved === true,
      JSON.stringify(delRes),
    );
    check(
      "the frame row is gone, and its observations cascaded with it",
      psql(`select count(*) from capture_frames where session_id='${dSid}'::uuid and seq=0;`).trim() === "0" &&
        psql(`select count(*) from capture_observations o join capture_frames f on f.id=o.frame_id
                where f.session_id='${dSid}'::uuid;`).trim() === "1",
    );
    check(
      "the storage object is deleted, revoking all access to the bytes",
      psql(`select count(*) from storage.objects where name='captures/${dSid}/frame-0000.jpg';`).trim() === "0",
    );
    check(
      "a tombstone records the deleted seq so the frame count never silently lies",
      psql(`select count(*) from capture_frame_tombstones where session_id='${dSid}'::uuid and seq=0;`).trim() === "1",
    );
    const detail2 = JSON.parse(psql(`select capture_session_review_detail('${dSid}'::uuid, 'test-secret');`).trim());
    check(
      "after delete, the detail read drops the frame and surfaces the tombstone",
      detail2.frames.length === 2 && detail2.frames.every((f) => f.seq !== 0) &&
        detail2.tombstones.length === 1 && detail2.tombstones[0].seq === 0,
      JSON.stringify({ frames: detail2.frames.map((f) => f.seq), tombstones: detail2.tombstones }),
    );
    const delAgain = JSON.parse(psql(`select capture_delete_frame('test-secret', '${dSid}'::uuid, 0);`).trim());
    check(
      "re-deleting an already-gone frame is idempotent (deleted, but no bytes to remove)",
      delAgain.deleted === true && delAgain.bytesRemoved === false,
      JSON.stringify(delAgain),
    );
    const delNever = JSON.parse(psql(`select capture_delete_frame('test-secret', '${dSid}'::uuid, 99);`).trim());
    check(
      "deleting a seq that never existed still tombstones it, without error",
      delNever.deleted === true && delNever.bytesRemoved === false &&
        psql(`select count(*) from capture_frame_tombstones where session_id='${dSid}'::uuid and seq=99;`).trim() === "1",
    );

    psql(`delete from capture_sessions where id='${cvSid}';`);
    check(
      "deleting a session cascades to its CV observations",
      psql(`select count(*) from community_cv_observations where session_id='${cvSid}';`).trim() === "0",
    );
    psql(`delete from capture_sessions where id='${dSid}';`);
    check(
      "deleting a session cascades to its frame tombstones",
      psql(`select count(*) from capture_frame_tombstones where session_id='${dSid}';`).trim() === "0",
    );

    /* ---------------- Cascades ---------------- */

    /* ---------------- 0025: pipeline truth (resume + reclaim) ---------------- */

    const cpSid = psql(`select capture_create_session('live', 'iphash-cp', null, '${SECRET}');`).trim();
    psql(`
      insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id)
      values ('${cpSid}'::uuid, 0, 'captures/${cpSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, 'seg-a'),
             ('${cpSid}'::uuid, 1, 'captures/${cpSid}/frame-0001.jpg', 1784000002000, 640, 480, 1000, 'seg-a');
      insert into capture_frame_jobs (frame_id) select id from capture_frames where session_id='${cpSid}'::uuid;
      update capture_sessions set status='cost_paused', pause_reason='session budget exhausted (10/10)' where id='${cpSid}'::uuid;
      update capture_frame_jobs j set status='failed_overbudget', error='input_tokens=999'
        from capture_frames f where f.id=j.frame_id and f.session_id='${cpSid}'::uuid and f.seq=0;
      update capture_frame_jobs j set status='pending'
        from capture_frames f where f.id=j.frame_id and f.session_id='${cpSid}'::uuid and f.seq=1;
    `);
    check(
      "capture_resume_cost_paused is secret-gated",
      (psqlExpectError(`select capture_resume_cost_paused('${cpSid}'::uuid, 'ops', 'budget raised', 'nope');`) || "").includes("unauthorized"),
    );
    check(
      "resume refuses a session that is not cost_paused",
      (() => {
        const other = psql(`select capture_create_session('live', 'iphash-not-cp', null, '${SECRET}');`).trim();
        return (psqlExpectError(`select capture_resume_cost_paused('${other}'::uuid, 'ops', 'try', 'test-secret');`) || "").includes("not cost_paused");
      })(),
    );
    const resumeResult = psql(
      `select capture_resume_cost_paused('${cpSid}'::uuid, 'ops@streetlens', 'budget raised for pilot', 'test-secret');`,
    );
    check("resume returns extracting", resumeResult.includes("extracting"));
    check(
      "resume flips session to extracting and records actor",
      psql(`select status || '|' || resume_actor from capture_sessions where id='${cpSid}'::uuid;`).trim()
        === "extracting|ops@streetlens",
    );
    check(
      "resume requeues failed_overbudget to pending",
      psql(`select status from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
             where f.session_id='${cpSid}'::uuid and f.seq=0;`).trim() === "pending",
    );
    check(
      "capture_session_status surfaces pauseReason",
      psql(`select (capture_session_status('${cpSid}'::uuid)::jsonb->>'pauseReason') is not null;`).trim() === "t",
    );
    check(
      "capture_reclaim_stale_jobs is secret-gated",
      (psqlExpectError(`select capture_reclaim_stale_jobs('nope');`) || "").includes("unauthorized"),
    );
    {
      const staleSid = psql(`select capture_create_session('live', 'iphash-stale', null, '${SECRET}');`).trim();
      psql(`
        insert into capture_frames (session_id, seq, storage_path, t, width, height, bytes, segment_id)
        values ('${staleSid}'::uuid, 0, 'captures/${staleSid}/frame-0000.jpg', 1784000000000, 640, 480, 1000, 'seg-z');
        insert into capture_frame_jobs (frame_id, status, claimed_at, attempts)
          select id, 'running', now() - interval '15 minutes', 1 from capture_frames where session_id='${staleSid}'::uuid;
        update capture_sessions set status='extracting' where id='${staleSid}'::uuid;
      `);
      const reclaimed = psql(`select capture_reclaim_stale_jobs('test-secret');`).trim();
      check("stale running job is reclaimed to pending", reclaimed === "1");
      check(
        "reclaimed job is pending again",
        psql(`select status from capture_frame_jobs j join capture_frames f on f.id=j.frame_id
               where f.session_id='${staleSid}'::uuid;`).trim() === "pending",
      );
    }
    check(
      "capture_session_review frames carry jobStatus and jobError",
      (() => {
        psql(`update capture_sessions set status='cost_paused' where id='${cpSid}'::uuid;`);
        const review = psql(`select capture_session_review('${cpSid}'::uuid, 'test-secret');`);
        return review.includes("jobStatus") && review.includes("jobError");
      })(),
    );

    psql(`delete from capture_sessions where id='${cpSid}';`);

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
    const secret = psql(`select capture_create_session('live', 'iphash-secret', 'private@example.com', '${SECRET}');`).trim();
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
