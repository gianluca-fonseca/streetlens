-- 0019_capture_reprocess.sql
-- Re-process a stuck capture session against the CURRENT street network.
--
-- WHY THIS EXISTS. A session filmed outside the pilot network attributes every
-- frame to `no_segment_match` and drains with nothing to score (session
-- b7c1da08-...: 11 frames, 49 track points, all failed because the walk was off
-- the audited network). When a later expansion puts streets under that walk, the
-- track is unchanged but the network is not, so re-running matching would now
-- place the frames. This migration is the write side of that re-run: a script
-- (scripts/reprocess-capture-session.mjs) re-matches the stored track LOCALLY
-- against the repo's current data/segments.geojson and hands the fresh
-- attribution here to be committed in one transaction.
--
-- Two functions, both ADMIN_RPC_SECRET-gated against app_secrets (the 0007/0015
-- pattern) — these are operator/worker calls, never a browser surface:
--
--   capture_session_track     — the read the reprocess script needs and 0015
--                               never shipped. capture_list_frames (0015) gives
--                               (seq, t); capture_session_review (0017) gives
--                               status + per-frame segment. Neither returns the
--                               stored track geometry, and re-matching needs the
--                               track. Note the track carries geometry but NOT
--                               per-vertex time (capture_finalize_session stores
--                               a bare LINESTRING); the script rebuilds vertex
--                               times from the frames' timestamps, which is why
--                               this returns geometry alone.
--
--   capture_reprocess_session — the commit. Re-attributes the previously
--                               unmatched frames, re-queues only the ones that
--                               now match, and hands the session back to the pump.
--
-- IDEMPOTENT AND SAFE ON ANYTHING. A session with no `no_segment_match` frame is
-- a clean no-op; a decided walk (approved/rejected) is refused, not retried; a
-- session mid-flight (pending_upload/uploading/matching/cost_paused/failed) is
-- refused because re-attribution there is either premature or a deliberate stop
-- someone else owns (the budget breaker owns cost_paused; see 0015/0017).
--
-- This migration touches NOTHING it did not create. The database is shared and
-- every object is `capture_`-prefixed.

/* ------------------------------------------------------------------ *
 * 1. Read the stored track (for local re-matching)
 * ------------------------------------------------------------------ */

-- The session's status/mode/frame_count and its raw track as an ordered
-- [{lng, lat}] array, dumped from the stored geography.
--
-- Secret-gated: it exposes the raw track, which the PUBLIC capture_session_status
-- (0013) deliberately withholds. No ip hash, no contact — the same PII posture as
-- every other read here.
--
-- The track array carries geometry only. Per-vertex time did not survive
-- finalize (the LINESTRING has none), so the caller reconstructs vertex times
-- from the frames before matching; returning geometry alone keeps this honest
-- about what the database actually holds.
create or replace function capture_session_track(
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
  v_track    jsonb;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select * into v_session from capture_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session not found';
  end if;

  -- st_dumppoints on the geography (cast to geometry) yields the vertices in
  -- path order; coalesce so a session that never finalized returns [] not null.
  select coalesce(
           jsonb_agg(
             jsonb_build_object('lng', st_x(dp.geom), 'lat', st_y(dp.geom))
             order by dp.path
           ),
           '[]'::jsonb
         )
    into v_track
    from st_dumppoints(v_session.track::geometry) as dp;

  return jsonb_build_object(
    'status',     v_session.status,
    'mode',       v_session.mode,
    'frameCount', v_session.frame_count,
    'track',      coalesce(v_track, '[]'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------------ *
 * 2. Commit a re-processing pass
 * ------------------------------------------------------------------ */

-- Re-attribute the previously unmatched frames and re-queue the ones that now
-- land on a segment, in ONE transaction.
--
-- p_attributions is [{seq, segmentId, nearJunction}] — the same shape
-- capture_attribute_frames (0015) takes, minus lng/lat: a re-match does not move
-- where a frame was shot (that is interpolated from the track by time and is
-- network-independent), so the stored location is left untouched.
--
-- SCOPE, DELIBERATELY NARROW. The only frames this touches are those whose job
-- is currently `failed` with error `no_segment_match` — the walk's off-network
-- casualties. A `done` frame keeps its observation and its provenance; a
-- `failed_overbudget` frame is the budget breaker's business, not a silent
-- retry; a `failed` frame with any other error was a model failure, not a
-- matching one. Re-attributing a `done` frame would desync its observation's
-- denormalized segment_id, so we never do.
--
-- RE-QUEUE ONLY WHAT NOW MATCHES. A no_segment_match job whose frame is STILL
-- off-network is left failed, exactly as finalize's capture_fail_unattributed_jobs
-- would leave it — resetting it to `pending` would strand the session, because
-- the pump only claims frames with a segment (capture_claim_jobs_with_frames,
-- 0015) and capture_drained_sessions never fires while a pending job lingers.
--
-- Guard rails: a decided session (approved/rejected) is history, not a retry
-- target; a session not in extracting/review_ready is refused; a payload that
-- names a frame not in the session is rejected outright.
--
-- The session's pending cv_capture row (if any) is left alone on purpose: it is
-- still pending and simply waits for the next drain, and capture_emit_submission
-- (0017) is idempotent, so nothing here needs to touch the queue.
create or replace function capture_reprocess_session(
  p_session_id   uuid,
  p_attributions jsonb,
  p_secret       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected      text;
  v_status        text;
  v_targets       uuid[];
  v_matched_now   integer;
  v_still         integer;
  v_new_status    text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  if jsonb_typeof(p_attributions) <> 'array' then
    raise exception 'attributions must be a json array';
  end if;

  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status in ('approved', 'rejected') then
    raise exception 'session already decided (status %); a decided walk is not a retry target', v_status;
  end if;
  if v_status not in ('extracting', 'review_ready') then
    raise exception 'session not reprocessable (status %); expected extracting or review_ready', v_status;
  end if;

  -- Reject a payload that names a frame the session does not have: a caller that
  -- is confused about which session it is reprocessing must fail loudly here
  -- rather than silently attribute nothing.
  if exists (
    select 1
      from jsonb_array_elements(p_attributions) as x
     where not exists (
       select 1 from capture_frames f
        where f.session_id = p_session_id
          and f.seq = (x->>'seq')::integer
     )
  ) then
    raise exception 'attribution references frames not in session %', p_session_id;
  end if;

  -- Snapshot the target frames BEFORE any mutation: the session's frames whose
  -- job is failed on no_segment_match. Everything below is scoped to these.
  select coalesce(array_agg(f.id), '{}')
    into v_targets
    from capture_frames f
    join capture_frame_jobs j on j.frame_id = f.id
   where f.session_id = p_session_id
     and j.status = 'failed'
     and j.error  = 'no_segment_match';

  -- (a) Re-attribute the target frames from the fresh payload. A null segmentId
  -- is a first-class answer (still off-network) and is stored as null.
  with a as (
    select
      (x->>'seq')::integer                          as seq,
      nullif(x->>'segmentId', '')                   as segment_id,
      coalesce((x->>'nearJunction')::boolean, false) as near_junction
    from jsonb_array_elements(p_attributions) as x
  )
  update capture_frames f
     set segment_id    = a.segment_id,
         near_junction = a.near_junction
    from a
   where f.id = any (v_targets)
     and f.seq = a.seq;

  -- (b) Re-queue only the target frames that now have a segment: their job goes
  -- back to pending with the error cleared, so the pump claims them next drain.
  with matched as (
    update capture_frame_jobs j
       set status     = 'pending',
           error      = null,
           updated_at = now()
      from capture_frames f
     where j.frame_id = f.id
       and f.id = any (v_targets)
       and f.segment_id is not null
    returning j.id
  )
  select count(*) into v_matched_now from matched;

  -- The target frames still off-network stay failed on no_segment_match (they are
  -- already in that state; nothing to write). Report the count for the operator.
  v_still := coalesce(array_length(v_targets, 1), 0) - v_matched_now;

  -- (c) Hand the session back to the pump only when there is fresh work. Nothing
  -- matched => nothing changes, the truest form of a safe no-op.
  if v_matched_now > 0 then
    update capture_sessions
       set status     = 'extracting',
           matched_at = now()
     where id = p_session_id;
    v_new_status := 'extracting';
  else
    v_new_status := v_status;
  end if;

  return jsonb_build_object(
    'reprocessed',   coalesce(array_length(v_targets, 1), 0),
    'matchedNow',    v_matched_now,
    'stillUnmatched', v_still,
    'requeued',      v_matched_now,
    'status',        v_new_status,
    'noop',          (v_matched_now = 0)
  );
end;
$$;

/* ------------------------------------------------------------------ *
 * 3. Grants
 *
 * Same posture as 0013/0015/0017: callable by anon/authenticated, each function
 * enforcing its own secret gate internally. The role is never trusted.
 * ------------------------------------------------------------------ */

revoke all on function capture_session_track(uuid, text) from public;
revoke all on function capture_reprocess_session(uuid, jsonb, text) from public;

grant execute on function capture_session_track(uuid, text) to anon, authenticated;
grant execute on function capture_reprocess_session(uuid, jsonb, text) to anon, authenticated;
