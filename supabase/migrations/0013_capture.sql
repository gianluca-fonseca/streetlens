-- 0013_capture.sql
-- The CV data-collection funnel: a contributor films a street, we place the
-- frames on the network and extract rubric v0.1 scores from them.
--
-- Pipeline, and the tables that carry it:
--   capture_sessions        one run (a walk/ride), its track and lifecycle
--   capture_frames          one image, its place on the network
--   capture_frame_jobs      the extraction work queue (one job per frame)
--   capture_observations    what a model saw in one frame
--   capture_segment_rollups per-segment medians once the frames are scored
--
-- SECURITY MODEL (same as 0007/0010/0012 — this deployment has NO service-role
-- key). Every table is RLS-on with ZERO policies, so anon and authenticated
-- cannot touch them at all. All access goes through the SECURITY DEFINER
-- functions at the bottom, which run as owner and therefore bypass RLS:
--   - Privileged ops authenticate ADMIN_RPC_SECRET against app_secrets (0007).
--   - Public ops are anon-callable but capability-scoped: knowing a session's
--     uuid is what authorizes acting on that session, and nothing else.
--
-- GEOMETRY TYPE — deliberate divergence from the rest of the repo. Segments use
-- `geometry(LineString, 4326)` (0002/0012); capture tracks and frame locations
-- use `geography` instead. Distance on a `geometry(4326)` is measured in
-- DEGREES, which is a live footgun for "is this fix within 30 m of that street";
-- geography measures in metres and gets the maths right. Nothing here joins
-- against segments.geom spatially, so the two coexist; where a later unit needs
-- to, it must cast explicitly (`segments.geom::geography`).
--
-- SHARED DATABASE: this database is shared with an unrelated project. Every
-- object below is prefixed `capture_` or `streetlens`, and this migration DROPS
-- NOTHING it did not create.

/* ------------------------------------------------------------------ *
 * 1. Tables
 * ------------------------------------------------------------------ */

create table if not exists capture_sessions (
  id              uuid primary key default gen_random_uuid(),
  mode            text not null check (mode in ('live', 'video')),
  -- Mirrors CaptureSessionStatus in lib/capture/types.ts. `cost_paused` is a
  -- deliberate stop (extraction budget exhausted, frames intact, a human
  -- resumes it), NOT an error; `failed` is terminal.
  status          text not null default 'pending_upload' check (
    status in (
      'pending_upload', 'uploading', 'matching', 'extracting',
      'cost_paused', 'review_ready', 'approved', 'rejected', 'failed'
    )
  ),
  -- The raw track as reported by the device. Null until finalize.
  track           geography (LineString, 4326),
  -- trueTime = deviceTime + clock_offset_ms. Recorded, never applied to the
  -- fixes: the stored track stays exactly what the device said.
  clock_offset_ms integer not null default 0,
  frame_count     integer not null default 0 check (frame_count >= 0),
  -- Named to match submissions.source_ip_hash (0005). Never a raw IP.
  source_ip_hash  text,
  contact         text,
  created_at      timestamptz not null default now(),
  -- One timestamp per lifecycle transition, so a stuck session is diagnosable.
  uploaded_at     timestamptz,
  matched_at      timestamptz,
  extracted_at    timestamptz,
  reviewed_at     timestamptz
);

create table if not exists capture_frames (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references capture_sessions (id) on delete cascade,
  seq          integer not null check (seq >= 0 and seq < 400),
  storage_path text not null,
  -- Capture time, epoch MILLISECONDS UTC. bigint, not integer: epoch ms
  -- overflows int4 by three orders of magnitude.
  t            bigint not null,
  -- Where the frame was shot, interpolated from the track at time `t`. Null
  -- when the matcher could not place it.
  location     geography (Point, 4326),
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  -- Must agree with the bucket's file_size_limit and CAPTURE_LIMITS.maxFrameBytes.
  bytes        integer not null check (bytes > 0 and bytes <= 2097152),
  blur_score   double precision,
  -- Matched segment. Intentionally NO foreign key: a match may land on a
  -- community segment (0012) or on nothing at all, and a capture must never be
  -- blocked by a segment being absent from the audited reference set.
  segment_id   text,
  near_junction boolean not null default false,
  created_at   timestamptz not null default now(),
  -- seq is the frame's identity within a session; re-registering one is a no-op.
  unique (session_id, seq)
);

create table if not exists capture_frame_jobs (
  id         uuid primary key default gen_random_uuid(),
  frame_id   uuid not null references capture_frames (id) on delete cascade,
  status     text not null default 'pending' check (
    status in ('pending', 'running', 'done', 'failed', 'failed_overbudget')
  ),
  attempts   integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one job per frame: the queue cannot fan out duplicate model spend.
  unique (frame_id)
);

create table if not exists capture_observations (
  id             uuid primary key default gen_random_uuid(),
  frame_id       uuid not null references capture_frames (id) on delete cascade,
  -- Denormalized from the frame at write time so a rollup never re-joins.
  segment_id     text,
  model          text not null,
  schema_version text not null default 'cv-v1',
  -- The 15 rubric v0.1 items; validated by captureObservationSchema
  -- (lib/capture/schemas.ts) BEFORE it ever reaches this column.
  items          jsonb not null,
  usable         boolean not null default true,
  confidence     numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  input_tokens   integer,
  output_tokens  integer,
  -- True when a cheap model abstained and a stronger one was asked instead.
  escalated      boolean not null default false,
  created_at     timestamptz not null default now(),
  -- One observation per model per frame — so a re-run overwrites rather than
  -- double-counting, and two models can be compared side by side.
  unique (frame_id, model)
);

create table if not exists capture_segment_rollups (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references capture_sessions (id) on delete cascade,
  segment_id   text not null,
  -- The five map lenses, 0-100, null when no frame could assess that lens.
  score_overall       numeric(5, 2) check (score_overall is null or (score_overall between 0 and 100)),
  score_accessibility numeric(5, 2) check (score_accessibility is null or (score_accessibility between 0 and 100)),
  score_drainage      numeric(5, 2) check (score_drainage is null or (score_drainage between 0 and 100)),
  score_shade         numeric(5, 2) check (score_shade is null or (score_shade between 0 and 100)),
  score_bike          numeric(5, 2) check (score_bike is null or (score_bike between 0 and 100)),
  -- Per-item medians, keyed by rubric item key.
  item_medians jsonb not null default '{}'::jsonb,
  -- Fraction of the segment observed by usable frames, 0-1.
  coverage     numeric(4, 3) check (coverage is null or (coverage between 0 and 1)),
  confidence   numeric(4, 3) check (confidence is null or (confidence between 0 and 1)),
  created_at   timestamptz not null default now(),
  unique (session_id, segment_id)
);

/* ------------------------------------------------------------------ *
 * 2. Indexes
 * ------------------------------------------------------------------ */

create index if not exists capture_sessions_track_gix    on capture_sessions using gist (track);
create index if not exists capture_sessions_status_ix    on capture_sessions (status, created_at desc);
-- The rate-limit lookup: sessions from one origin in the last hour.
create index if not exists capture_sessions_ip_ix        on capture_sessions (source_ip_hash, created_at desc);

create index if not exists capture_frames_location_gix   on capture_frames using gist (location);
create index if not exists capture_frames_session_ix     on capture_frames (session_id, seq);
create index if not exists capture_frames_segment_ix     on capture_frames (segment_id);
-- The storage RLS policy probes by path on every single upload.
create index if not exists capture_frames_path_ix        on capture_frames (storage_path);

-- The pump's claim query: oldest pending jobs first.
create index if not exists capture_frame_jobs_status_ix  on capture_frame_jobs (status, created_at);
create index if not exists capture_frame_jobs_frame_ix   on capture_frame_jobs (frame_id);

create index if not exists capture_observations_frame_ix   on capture_observations (frame_id);
create index if not exists capture_observations_segment_ix on capture_observations (segment_id);

create index if not exists capture_rollups_session_ix    on capture_segment_rollups (session_id);
create index if not exists capture_rollups_segment_ix    on capture_segment_rollups (segment_id);

/* ------------------------------------------------------------------ *
 * 3. RLS — deny by default
 *
 * RLS on with zero policies => no anon/authenticated access whatsoever. The
 * SECURITY DEFINER functions below are the ONLY way in. Note this is stricter
 * than the published reference tables (0006), which are publicly readable:
 * a capture in flight is unreviewed contributor data, not open data, and its
 * ip hashes and contact details must never be world-readable.
 * ------------------------------------------------------------------ */

alter table capture_sessions        enable row level security;
alter table capture_frames          enable row level security;
alter table capture_frame_jobs      enable row level security;
alter table capture_observations    enable row level security;
alter table capture_segment_rollups enable row level security;

/* ------------------------------------------------------------------ *
 * 4. Storage bucket
 *
 * PUBLIC READ — a sealed tradeoff, not an oversight. Frame paths are
 * `captures/<uuid>/frame-NNNN.jpg`, so the unguessable session uuid IS the
 * capability: you cannot enumerate the bucket, and a link-holder can read.
 * The pilot needs the review UI and the extraction model to fetch frames
 * without signing every URL. Revisit if captures ever carry faces or plates
 * that survive to storage.
 * ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('streetlens-frames', 'streetlens-frames', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anon may INSERT one object ONLY when a matching capture_frames row was
-- already registered and its session still accepts uploads. Registration is
-- therefore the authorization step: the client cannot invent a path, cannot
-- upload to a finalized session, and cannot exceed the frame ceiling (the
-- register RPC enforces it).
--
-- There are deliberately NO update/delete policies: frames are write-once.
-- Storage still enforces the bucket's own 2 MB / image-jpeg limits on top.
drop policy if exists capture_frames_anon_insert on storage.objects;
create policy capture_frames_anon_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'streetlens-frames'
    -- Belt and braces: the path convention is re-checked here even though the
    -- register RPC already derived it.
    and name ~ '^captures/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/frame-[0-9]{4}\.jpg$'
    and exists (
      select 1
        from capture_frames f
        join capture_sessions s on s.id = f.session_id
       where f.storage_path = storage.objects.name
         and s.status in ('pending_upload', 'uploading')
    )
  );

/* ------------------------------------------------------------------ *
 * 5. Public RPCs — anon-callable, capability-scoped by session uuid
 * ------------------------------------------------------------------ */

-- Open a session. Enforces the per-origin ceiling IN THE DATABASE.
--
-- lib/rate-limit.ts also throttles this at the edge, but that bucket lives in
-- process memory and resets on every cold start (it says so itself). This check
-- is the one that actually holds fleet-wide, so the ceiling lives in both
-- places on purpose: the app rejects cheaply, the database rejects truthfully.
create or replace function capture_create_session(
  p_mode    text,
  p_ip_hash text default null,
  p_contact text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
  v_id     uuid;
begin
  if p_mode not in ('live', 'video') then
    raise exception 'invalid mode: %', p_mode;
  end if;

  if p_ip_hash is not null then
    select count(*) into v_recent
      from capture_sessions
     where source_ip_hash = p_ip_hash
       and created_at > now() - interval '1 hour';
    if v_recent >= 3 then
      raise exception 'rate_limited';
    end if;
  end if;

  insert into capture_sessions (mode, source_ip_hash, contact)
  values (p_mode, p_ip_hash, nullif(btrim(p_contact), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- Register a batch of frames for an open session, returning the seqs now on
-- record. This is what authorizes the storage uploads that follow.
--
-- Idempotent by (session_id, seq) so a client that retries a partial batch is
-- not punished; the returned array is the client's resume cursor.
create or replace function capture_register_frames(
  p_session_id uuid,
  p_frames     jsonb
) returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_accepted integer[];
begin
  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status not in ('pending_upload', 'uploading') then
    raise exception 'session does not accept uploads (status %)', v_status;
  end if;

  if jsonb_typeof(p_frames) <> 'array' then
    raise exception 'frames must be a json array';
  end if;

  -- The frame ceiling is enforced here, against what is already on record plus
  -- what is arriving, so a client cannot walk past it one batch at a time.
  if (
    select count(*) from capture_frames where session_id = p_session_id
  ) + jsonb_array_length(p_frames) > 400 then
    raise exception 'frame limit exceeded';
  end if;

  insert into capture_frames (
    session_id, seq, storage_path, t, width, height, bytes, blur_score
  )
  select
    p_session_id,
    (f->>'seq')::integer,
    -- The path is DERIVED here, never taken from the client. A client-supplied
    -- path is the whole attack surface of a public-insert bucket.
    'captures/' || p_session_id::text || '/frame-' || lpad(f->>'seq', 4, '0') || '.jpg',
    (f->>'t')::bigint,
    (f->>'width')::integer,
    (f->>'height')::integer,
    (f->>'bytes')::integer,
    nullif(f->>'blurScore', '')::double precision
  from jsonb_array_elements(p_frames) as f
  on conflict (session_id, seq) do nothing;

  update capture_sessions
     set status      = case when status = 'pending_upload' then 'uploading' else status end,
         frame_count = (select count(*) from capture_frames where session_id = p_session_id)
   where id = p_session_id;

  select array_agg(seq order by seq) into v_accepted
    from capture_frames where session_id = p_session_id;

  return coalesce(v_accepted, array[]::integer[]);
end;
$$;

-- Close a session: attach the track and hand it to the matcher.
--
-- Anon-callable on the same capability basis as register_frames (holding the
-- session uuid is the authorization). Only valid while the session still
-- accepts uploads, so a finalized capture cannot have its track rewritten.
create or replace function capture_finalize_session(
  p_session_id      uuid,
  p_track           jsonb,
  p_clock_offset_ms integer default 0
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status not in ('pending_upload', 'uploading') then
    raise exception 'session already finalized (status %)', v_status;
  end if;

  update capture_sessions
     set track           = st_geogfromtext(
                             'SRID=4326;LINESTRING(' || (
                               select string_agg(
                                        (p->>'lng') || ' ' || (p->>'lat'),
                                        ',' order by ord
                                      )
                                 from jsonb_array_elements(p_track) with ordinality as x(p, ord)
                             ) || ')'
                           ),
         clock_offset_ms = coalesce(p_clock_offset_ms, 0),
         status          = 'matching',
         uploaded_at     = coalesce(uploaded_at, now())
   where id = p_session_id;

  -- One extraction job per registered frame. Idempotent via the unique(frame_id).
  insert into capture_frame_jobs (frame_id)
  select id from capture_frames where session_id = p_session_id
  on conflict (frame_id) do nothing;

  return 'matching';
end;
$$;

-- Read your own session by uuid. Returns ONLY what the contributor's progress
-- view needs — deliberately no ip hash, no contact, no raw track.
create or replace function capture_session_status(p_session_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result json;
begin
  select json_build_object(
    'status',     s.status,
    'frameCount', s.frame_count,
    'jobs', json_build_object(
      'pending', (select count(*) from capture_frame_jobs j join capture_frames f on f.id = j.frame_id
                   where f.session_id = s.id and j.status in ('pending', 'running')),
      'done',    (select count(*) from capture_frame_jobs j join capture_frames f on f.id = j.frame_id
                   where f.session_id = s.id and j.status = 'done'),
      'failed',  (select count(*) from capture_frame_jobs j join capture_frames f on f.id = j.frame_id
                   where f.session_id = s.id and j.status in ('failed', 'failed_overbudget'))
    ),
    'rollups', (
      select coalesce(json_agg(json_build_object(
               'segmentId',  r.segment_id,
               'coverage',   r.coverage,
               'confidence', r.confidence,
               'scores', json_build_object(
                 'overall',       r.score_overall,
                 'accessibility', r.score_accessibility,
                 'drainage',      r.score_drainage,
                 'shade',         r.score_shade,
                 'bike',          r.score_bike
               )
             )), '[]'::json)
        from capture_segment_rollups r where r.session_id = s.id
    )
  ) into v_result
  from capture_sessions s
  where s.id = p_session_id;

  if v_result is null then
    raise exception 'session not found';
  end if;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * 6. Privileged RPCs — ADMIN_RPC_SECRET gated (the 0007 pattern)
 * ------------------------------------------------------------------ */

-- Claim up to p_limit pending jobs for extraction.
--
-- FOR UPDATE SKIP LOCKED is what makes the pump safe to run concurrently: two
-- pumps racing claim disjoint sets instead of both paying a model for the same
-- frame.
create or replace function capture_claim_jobs(
  p_limit  integer,
  p_secret text
) returns setof capture_frame_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  return query
  with claimed as (
    select j.id
      from capture_frame_jobs j
     where j.status = 'pending'
     order by j.created_at
     limit greatest(coalesce(p_limit, 1), 1)
     for update skip locked
  )
  update capture_frame_jobs j
     set status     = 'running',
         attempts   = j.attempts + 1,
         claimed_at = now(),
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
end;
$$;

-- Record a successful extraction: the observation, and the job closed out.
create or replace function capture_complete_job(
  p_frame_id      uuid,
  p_model         text,
  p_items         jsonb,
  p_usable        boolean,
  p_confidence    numeric,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_escalated     boolean,
  p_secret        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected   text;
  v_segment_id text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select segment_id into v_segment_id from capture_frames where id = p_frame_id;

  insert into capture_observations (
    frame_id, segment_id, model, items, usable, confidence,
    input_tokens, output_tokens, escalated
  )
  values (
    p_frame_id, v_segment_id, p_model, p_items, coalesce(p_usable, true), p_confidence,
    p_input_tokens, p_output_tokens, coalesce(p_escalated, false)
  )
  -- A re-run replaces that model's answer rather than double-counting it.
  on conflict (frame_id, model) do update
    set items         = excluded.items,
        segment_id    = excluded.segment_id,
        usable        = excluded.usable,
        confidence    = excluded.confidence,
        input_tokens  = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        escalated     = excluded.escalated,
        created_at    = now();

  update capture_frame_jobs
     set status = 'done', error = null, updated_at = now()
   where frame_id = p_frame_id;
end;
$$;

-- Close a job out as failed. `failed_overbudget` is kept distinct from `failed`
-- because it is retryable the moment budget returns, while `failed` is not.
create or replace function capture_fail_job(
  p_frame_id uuid,
  p_status   text,
  p_error    text,
  p_secret   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  if p_status not in ('failed', 'failed_overbudget', 'pending') then
    raise exception 'invalid job status: %', p_status;
  end if;

  update capture_frame_jobs
     set status = p_status, error = left(p_error, 2000), updated_at = now()
   where frame_id = p_frame_id;
end;
$$;

-- Write the per-segment rollup for a session.
create or replace function capture_upsert_rollup(
  p_session_id   uuid,
  p_segment_id   text,
  p_scores       jsonb,
  p_item_medians jsonb,
  p_coverage     numeric,
  p_confidence   numeric,
  p_secret       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  insert into capture_segment_rollups (
    session_id, segment_id, score_overall, score_accessibility, score_drainage,
    score_shade, score_bike, item_medians, coverage, confidence
  )
  values (
    p_session_id, p_segment_id,
    (p_scores->>'overall')::numeric,
    (p_scores->>'accessibility')::numeric,
    (p_scores->>'drainage')::numeric,
    (p_scores->>'shade')::numeric,
    (p_scores->>'bike')::numeric,
    coalesce(p_item_medians, '{}'::jsonb),
    p_coverage, p_confidence
  )
  on conflict (session_id, segment_id) do update
    set score_overall       = excluded.score_overall,
        score_accessibility = excluded.score_accessibility,
        score_drainage      = excluded.score_drainage,
        score_shade         = excluded.score_shade,
        score_bike          = excluded.score_bike,
        item_medians        = excluded.item_medians,
        coverage            = excluded.coverage,
        confidence          = excluded.confidence,
        created_at          = now();
end;
$$;

-- Move a session's lifecycle marker. Used by the matcher, the pump and review.
create or replace function capture_set_session_status(
  p_session_id uuid,
  p_status     text,
  p_secret     text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  update capture_sessions
     set status       = p_status,
         matched_at   = case when p_status = 'extracting'   then now() else matched_at end,
         extracted_at = case when p_status = 'review_ready' then now() else extracted_at end,
         reviewed_at  = case when p_status in ('approved', 'rejected') then now() else reviewed_at end
   where id = p_session_id;

  if not found then
    raise exception 'session not found';
  end if;

  return p_status;
end;
$$;

/* ------------------------------------------------------------------ *
 * 7. Grants
 *
 * Same posture as 0007: the functions are callable by anon, and each one
 * enforces its own gate internally. For the privileged set the gate is the
 * secret; for the public set it is the session uuid capability. The ROLE is
 * never the thing being trusted.
 * ------------------------------------------------------------------ */

revoke all on function capture_create_session(text, text, text) from public;
revoke all on function capture_register_frames(uuid, jsonb) from public;
revoke all on function capture_finalize_session(uuid, jsonb, integer) from public;
revoke all on function capture_session_status(uuid) from public;
revoke all on function capture_claim_jobs(integer, text) from public;
revoke all on function capture_complete_job(uuid, text, jsonb, boolean, numeric, integer, integer, boolean, text) from public;
revoke all on function capture_fail_job(uuid, text, text, text) from public;
revoke all on function capture_upsert_rollup(uuid, text, jsonb, jsonb, numeric, numeric, text) from public;
revoke all on function capture_set_session_status(uuid, text, text) from public;

grant execute on function capture_create_session(text, text, text) to anon, authenticated;
grant execute on function capture_register_frames(uuid, jsonb) to anon, authenticated;
grant execute on function capture_finalize_session(uuid, jsonb, integer) to anon, authenticated;
grant execute on function capture_session_status(uuid) to anon, authenticated;
grant execute on function capture_claim_jobs(integer, text) to anon, authenticated;
grant execute on function capture_complete_job(uuid, text, jsonb, boolean, numeric, integer, integer, boolean, text) to anon, authenticated;
grant execute on function capture_fail_job(uuid, text, text, text) to anon, authenticated;
grant execute on function capture_upsert_rollup(uuid, text, jsonb, jsonb, numeric, numeric, text) to anon, authenticated;
grant execute on function capture_set_session_status(uuid, text, text) to anon, authenticated;
