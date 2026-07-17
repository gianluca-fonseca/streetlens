-- 0017_capture_review.sql
-- The CV review loop closes: a finished capture session reaches a human, and an
-- approved one reaches the map (u30).
--
-- Two additions, for two reasons:
--
--   capture_emit_submission        — the pump files a drained session into the
--                                    review queue as a cv_capture row. It exists
--                                    as an RPC rather than an insert from app
--                                    code because the emit must be idempotent and
--                                    0006 gives anon INSERT on submissions with
--                                    deliberately NO SELECT policy: application
--                                    code physically cannot check whether the row
--                                    it is about to write is already there.
--
--   community_cv_observations      — the THIRD community record kind, after
--   + admin_apply_capture_session    segments (0012) and reports (0012). An
--                                    approved session's rollups land here and are
--                                    merged at read time. They are NOT audits and
--                                    never touch audits/observations/segments.
--
-- Why NOT extend admin_apply_submission: it is per-submission and ends in
-- `raise exception 'unsupported submission type'` (0012). CV approval is
-- per-SEGMENT — an admin approves some segments of a walk and rejects others —
-- which that signature cannot express. Worse, the TS caller catches RPC errors
-- and falls back to the local store, so routing CV through it would turn an
-- unsupported type into a silent local write that reports success.
--
-- This migration touches NOTHING it did not create. The database is shared.

-- 1. Queue emit --------------------------------------------------------------

-- Idempotency for the emit, enforced where it cannot be raced: one cv_capture row
-- per session, regardless of how many pumps drain it concurrently. Partial, so it
-- costs nothing for the other three submission types.
create unique index if not exists submissions_cv_capture_session_uix
  on submissions ((payload ->> 'session_id'))
  where type = 'cv_capture';

-- Called by the extraction pump when a session's job queue drains, BEFORE the
-- session is flipped to review_ready (that write is a one-way latch — see
-- lib/capture/pump.ts). Safe to call repeatedly: the second call is a no-op.
create or replace function capture_emit_submission(
  p_session_id uuid,
  p_secret     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_exists   boolean;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select exists (select 1 from capture_sessions where id = p_session_id)
    into v_exists;
  if not v_exists then
    raise exception 'session not found';
  end if;

  -- The unique index above is what makes this safe under concurrent pumps; the
  -- on-conflict is how we decline to care that we lost the race.
  insert into submissions (type, payload, status, source_ip_hash, honeypot_tripped)
  values (
    'cv_capture',
    jsonb_build_object('session_id', p_session_id::text),
    'pending',
    null,
    false
  )
  on conflict do nothing;
end;
$$;

-- 2. Approved CV observations ------------------------------------------------

create table if not exists community_cv_observations (
  -- Derived id ('cv-<session>-<segment>'), so re-approving upserts.
  id                  text primary key,
  -- The observed segment: an audited segments.id OR a community_segments.id.
  -- Intentionally NOT a foreign key, exactly as community_reports (two possible
  -- parents); the app resolves it.
  segment_id          text not null,
  session_id          uuid not null references capture_sessions (id) on delete cascade,
  -- Nullable on purpose: a lens no frame could support is UNKNOWN, not zero.
  -- Writing 0 here would be inventing a bad score for a street nobody saw.
  score_overall       numeric(5, 2) check (score_overall is null or (score_overall between 0 and 100)),
  score_accessibility numeric(5, 2) check (score_accessibility is null or (score_accessibility between 0 and 100)),
  score_drainage      numeric(5, 2) check (score_drainage is null or (score_drainage between 0 and 100)),
  score_shade         numeric(5, 2) check (score_shade is null or (score_shade between 0 and 100)),
  score_bike          numeric(5, 2) check (score_bike is null or (score_bike between 0 and 100)),
  item_medians        jsonb not null default '{}'::jsonb,
  coverage            numeric(4, 3) check (coverage is null or (coverage between 0 and 1)),
  confidence          numeric(4, 3) check (confidence is null or (confidence between 0 and 1)),
  -- Bucket-relative storage paths of the frames behind this observation.
  frame_refs          jsonb not null default '[]'::jsonb,
  -- When the walk happened, not when it was approved.
  captured_on         timestamptz,
  submission_id       uuid references submissions (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (session_id, segment_id)
);

create index if not exists community_cv_observations_segment_ix
  on community_cv_observations (segment_id);
create index if not exists community_cv_observations_session_ix
  on community_cv_observations (session_id);

-- Public read (open data, same as community_segments/community_reports). No
-- INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER function below writes,
-- and it authenticates the admin secret internally.
alter table community_cv_observations enable row level security;

-- Dropped first because `create policy` has no IF NOT EXISTS, and this migration
-- must survive being applied twice (the chain is re-run in the migration check,
-- and the Conductor applies against a shared database).
drop policy if exists community_cv_observations_public_read on community_cv_observations;
create policy community_cv_observations_public_read
  on community_cv_observations
  for select to anon, authenticated
  using (true);

-- 3. The admin review read --------------------------------------------------
-- Everything the review page needs, in one gated round trip.
--
-- It exists because capture_session_status (0013) deliberately cannot serve this:
-- that one is PUBLIC (the session uuid is its capability), so it exposes no ip
-- hash, no contact, no token spend, and its rollup projection carries no
-- item_medians. An admin needs all of that, so it is a separate, secret-gated
-- function rather than a widening of the public one — widening it would have
-- leaked cost and contact data to anyone holding a session link.
--
-- Frames come back with their segment attribution so the page can hang a
-- filmstrip off each segment. Storage paths only: the bucket is public and the
-- app builds URLs (lib/capture/storage.ts), so the database stays ignorant of
-- deployment URLs.

create or replace function capture_session_review(
  p_session_id uuid,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_session  capture_sessions;
  v_result   jsonb;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select * into v_session from capture_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session not found';
  end if;

  select jsonb_build_object(
    'sessionId',   v_session.id,
    'status',      v_session.status,
    'mode',        v_session.mode,
    'frameCount',  v_session.frame_count,
    'capturedOn',  coalesce(v_session.extracted_at, v_session.uploaded_at, v_session.created_at),
    'reviewedAt',  v_session.reviewed_at,
    'jobs', (
      select jsonb_build_object(
        'pending', count(*) filter (where j.status in ('pending', 'running')),
        'done',    count(*) filter (where j.status = 'done'),
        'failed',  count(*) filter (where j.status in ('failed', 'failed_overbudget')),
        -- Surfaced separately from `failed`: overbudget means the money ran out,
        -- not that the frame was bad, and the page must not conflate the two.
        'overbudget', count(*) filter (where j.status = 'failed_overbudget')
      )
      from capture_frame_jobs j
      join capture_frames f on f.id = j.frame_id
      where f.session_id = p_session_id
    ),
    'tokens', (
      select jsonb_build_object(
        'inputTokens',  coalesce(sum(o.input_tokens), 0),
        'outputTokens', coalesce(sum(o.output_tokens), 0),
        'observations', count(*),
        'escalated',    count(*) filter (where o.escalated)
      )
      from capture_observations o
      join capture_frames f on f.id = o.frame_id
      where f.session_id = p_session_id
    ),
    'rollups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'segmentId', r.segment_id,
        'scores', jsonb_build_object(
          'overall',       r.score_overall,
          'accessibility', r.score_accessibility,
          'drainage',      r.score_drainage,
          'shade',         r.score_shade,
          'bike',          r.score_bike
        ),
        'itemMedians', r.item_medians,
        'coverage',    r.coverage,
        'confidence',  r.confidence,
        'escalated', (
          select count(*) from capture_observations o2
           join capture_frames f2 on f2.id = o2.frame_id
           where f2.session_id = p_session_id
             and f2.segment_id = r.segment_id
             and o2.escalated
        )
      ) order by r.segment_id)
      from capture_segment_rollups r
      where r.session_id = p_session_id
    ), '[]'::jsonb),
    'frames', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq',         f.seq,
        'storagePath', f.storage_path,
        'segmentId',   f.segment_id
      ) order by f.seq)
      from capture_frames f
      where f.session_id = p_session_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- 4. Apply an approved capture session ---------------------------------------
-- The whole approval in one transaction: land the observations the admin ticked,
-- drop the ones they did not, close the submission, and stamp the session.
--
-- p_observations is the already-built row set (lib/apply-submissions.ts owns the
-- shape and the derived ids), passed as jsonb.
--
-- The delete is not housekeeping. Approval is per-segment and re-reviewable, so
-- an admin who unticks a segment and re-approves MUST see it leave the map; an
-- upsert alone would leave the old row published forever.

create or replace function admin_apply_capture_session(
  p_secret        text,
  p_session_id    uuid,
  p_submission_id uuid,
  p_observations  jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_count    integer;
  v_keep     text[];
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'p_observations must be a jsonb array';
  end if;

  select coalesce(array_agg(o ->> 'id'), '{}')
    into v_keep
    from jsonb_array_elements(p_observations) as o;

  -- Retract anything from this session the admin did not approve this time.
  delete from community_cv_observations
   where session_id = p_session_id
     and not (id = any (v_keep));

  insert into community_cv_observations (
    id, segment_id, session_id,
    score_overall, score_accessibility, score_drainage, score_shade, score_bike,
    item_medians, coverage, confidence, frame_refs, captured_on,
    submission_id, created_at
  )
  select
    o ->> 'id',
    o ->> 'segment_id',
    p_session_id,
    nullif(o -> 'scores' ->> 'overall', '')::numeric,
    nullif(o -> 'scores' ->> 'accessibility', '')::numeric,
    nullif(o -> 'scores' ->> 'drainage', '')::numeric,
    nullif(o -> 'scores' ->> 'shade', '')::numeric,
    nullif(o -> 'scores' ->> 'bike', '')::numeric,
    coalesce(o -> 'item_medians', '{}'::jsonb),
    nullif(o ->> 'coverage', '')::numeric,
    nullif(o ->> 'confidence', '')::numeric,
    coalesce(o -> 'frame_refs', '[]'::jsonb),
    nullif(o ->> 'captured_on', '')::timestamptz,
    p_submission_id,
    now()
  from jsonb_array_elements(p_observations) as o
  on conflict (id) do update
    set segment_id          = excluded.segment_id,
        score_overall       = excluded.score_overall,
        score_accessibility = excluded.score_accessibility,
        score_drainage      = excluded.score_drainage,
        score_shade         = excluded.score_shade,
        score_bike          = excluded.score_bike,
        item_medians        = excluded.item_medians,
        coverage            = excluded.coverage,
        confidence          = excluded.confidence,
        frame_refs          = excluded.frame_refs,
        captured_on         = excluded.captured_on,
        submission_id       = excluded.submission_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Secret-gated, not role-gated: callable by anon/authenticated but each function
-- enforces the admin secret internally (the deployment has no service role).
revoke all on function capture_emit_submission(uuid, text) from public;
revoke all on function capture_session_review(uuid, text) from public;
revoke all on function admin_apply_capture_session(text, uuid, uuid, jsonb) from public;
grant execute on function capture_emit_submission(uuid, text) to anon, authenticated;
grant execute on function capture_session_review(uuid, text) to anon, authenticated;
grant execute on function admin_apply_capture_session(text, uuid, uuid, jsonb) to anon, authenticated;
