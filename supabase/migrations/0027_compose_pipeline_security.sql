-- 0027_compose_pipeline_security.sql (conductor)
-- 0025 (pipeline truth) and 0026 (security core) were built by parallel lanes
-- from the same 0024 baseline, and 0026's create-or-replace bodies were written
-- blind to 0025's additions. Applied in sequence they interact three ways:
--
--   1. 0026 hashes admin_rpc_secret at rest, but 0025's five new/changed
--      functions still compare plaintext -> they would reject every caller.
--   2. 0026's claim RPCs (rewritten from the 0024 shape) drop 0025's
--      `perform capture_reclaim_stale_jobs(...)` -> stale-job reclaim silently
--      stops running, undoing pipeline-truth mandate 2.
--   3. 0026 recreates capture_set_session_status with the old 3-arg signature
--      while 0025's 4-arg (defaulted) version persists -> two overloads, and a
--      3-arg call becomes ambiguous.
--
-- This migration re-establishes the COMPOSED truth on top of both: every
-- function below is 0025's semantics under 0026's assert_admin_secret regime.

/* ------------------------------------------------------------------ *
 * 1. Kill the ambiguous overload; keep only the 4-arg (0025) signature
 * ------------------------------------------------------------------ */

drop function if exists capture_set_session_status(uuid, text, text);

create or replace function capture_set_session_status(
  p_session_id   uuid,
  p_status       text,
  p_secret       text,
  p_pause_reason text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin_secret(p_secret);

  update capture_sessions
     set status       = p_status,
         pause_reason = case
                          when p_status = 'cost_paused' and p_pause_reason is not null
                            then p_pause_reason
                          else pause_reason
                        end,
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
 * 2. Reclaim + resume under the hashed-secret regime
 * ------------------------------------------------------------------ */

create or replace function capture_reclaim_stale_jobs(
  p_secret text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform assert_admin_secret(p_secret);

  update capture_frame_jobs
     set status     = 'pending',
         updated_at = now()
   where status = 'running'
     and claimed_at < now() - interval '10 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function capture_resume_cost_paused(
  p_session_id   uuid,
  p_actor        text,
  p_reason       text,
  p_secret       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_requeued integer;
begin
  perform assert_admin_secret(p_secret);

  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'resume actor is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'resume reason is required';
  end if;

  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status <> 'cost_paused' then
    raise exception 'session not cost_paused (status %); only cost_paused sessions may be resumed', v_status;
  end if;

  update capture_frame_jobs j
     set status     = 'pending',
         error      = null,
         updated_at = now()
    from capture_frames f
   where f.id = j.frame_id
     and f.session_id = p_session_id
     and j.status = 'failed_overbudget';

  get diagnostics v_requeued = row_count;

  update capture_sessions
     set status        = 'extracting',
         resume_actor  = btrim(p_actor),
         resume_reason = btrim(p_reason),
         resumed_at    = now()
   where id = p_session_id;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'status',    'extracting',
    'requeued',  v_requeued
  );
end;
$$;

/* ------------------------------------------------------------------ *
 * 3. Claim RPCs — hashed secret AND the stale reclaim, together
 * ------------------------------------------------------------------ */

create or replace function capture_claim_jobs_with_frames(
  p_limit  integer,
  p_secret text
) returns table (
  job_id        uuid,
  frame_id      uuid,
  attempts      integer,
  session_id    uuid,
  seq           integer,
  storage_path  text,
  segment_id    text,
  near_junction boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin_secret(p_secret);
  perform capture_reclaim_stale_jobs(p_secret);

  return query
  with claimed as (
    select j.id
      from capture_frame_jobs j
      join capture_frames f   on f.id = j.frame_id
      join capture_sessions s on s.id = f.session_id
     where j.status = 'pending'
       and s.status = 'extracting'
       and f.segment_id is not null
     order by j.created_at
     limit greatest(coalesce(p_limit, 1), 1)
     for update of j skip locked
  ),
  taken as (
    update capture_frame_jobs j
       set status     = 'running',
           attempts   = j.attempts + 1,
           claimed_at = now(),
           updated_at = now()
      from claimed
     where j.id = claimed.id
    returning j.id, j.frame_id, j.attempts
  )
  select t.id, t.frame_id, t.attempts, f.session_id, f.seq,
         f.storage_path, f.segment_id, f.near_junction
    from taken t
    join capture_frames f on f.id = t.frame_id;
end;
$$;

create or replace function capture_claim_jobs_for_session(
  p_session_id uuid,
  p_limit      integer,
  p_secret     text
) returns table (
  job_id        uuid,
  frame_id      uuid,
  attempts      integer,
  session_id    uuid,
  seq           integer,
  storage_path  text,
  segment_id    text,
  near_junction boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin_secret(p_secret);
  perform capture_reclaim_stale_jobs(p_secret);

  return query
  with claimed as (
    select j.id
      from capture_frame_jobs j
      join capture_frames f   on f.id = j.frame_id
      join capture_sessions s on s.id = f.session_id
     where j.status = 'pending'
       and s.status = 'extracting'
       and f.segment_id is not null
       and s.id = p_session_id
     order by j.created_at
     limit greatest(coalesce(p_limit, 1), 1)
     for update of j skip locked
  ),
  taken as (
    update capture_frame_jobs j
       set status     = 'running',
           attempts   = j.attempts + 1,
           claimed_at = now(),
           updated_at = now()
      from claimed
     where j.id = claimed.id
    returning j.id as job_id, j.frame_id, j.attempts
  )
  select t.job_id, t.frame_id, t.attempts,
         f.session_id, f.seq, f.storage_path, f.segment_id, f.near_junction
    from taken t
    join capture_frames f on f.id = t.frame_id;
end;
$$;

/* ------------------------------------------------------------------ *
 * 4. capture_session_review — 0025's observability superset, hashed secret
 * ------------------------------------------------------------------ */

create or replace function capture_session_review(
  p_session_id uuid,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session capture_sessions;
  v_result  jsonb;
begin
  perform assert_admin_secret(p_secret);

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
    'pauseReason', v_session.pause_reason,
    'resumeActor', v_session.resume_actor,
    'resumeReason', v_session.resume_reason,
    'resumedAt',   v_session.resumed_at,
    'jobs', (
      select jsonb_build_object(
        'pending', count(*) filter (where j.status in ('pending', 'running')),
        'done',    count(*) filter (where j.status = 'done'),
        'failed',  count(*) filter (where j.status in ('failed', 'failed_overbudget')),
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
        'escalated',    count(*) filter (where o.escalated),
        'synthesisInputTokens', coalesce((
          select sum(r.synthesis_input_tokens) from capture_segment_rollups r
           where r.session_id = p_session_id
        ), 0),
        'synthesisOutputTokens', coalesce((
          select sum(r.synthesis_output_tokens) from capture_segment_rollups r
           where r.session_id = p_session_id
        ), 0)
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
        'assessment',  r.assessment,
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
        'segmentId',   f.segment_id,
        'jobStatus',   j.status,
        'jobError',    j.error,
        'jobAttempts', j.attempts,
        'observation', (
          select jsonb_build_object(
            'items',     o.items,
            'rationale', o.rationale,
            'escalated', o.escalated,
            'model',     o.model
          )
          from capture_observations o
          where o.frame_id = f.id
          order by o.escalated desc, o.created_at desc
          limit 1
        )
      ) order by f.seq)
      from capture_frames f
      left join capture_frame_jobs j on j.frame_id = f.id
      where f.session_id = p_session_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * 5. Grants (match the house pattern: in-function secret checks, anon exec)
 * ------------------------------------------------------------------ */

revoke all on function capture_set_session_status(uuid, text, text, text) from public;
revoke all on function capture_reclaim_stale_jobs(text) from public;
revoke all on function capture_resume_cost_paused(uuid, text, text, text) from public;
revoke all on function capture_claim_jobs_with_frames(integer, text) from public;
revoke all on function capture_claim_jobs_for_session(uuid, integer, text) from public;
revoke all on function capture_session_review(uuid, text) from public;

grant execute on function capture_set_session_status(uuid, text, text, text) to anon, authenticated;
grant execute on function capture_reclaim_stale_jobs(text) to anon, authenticated;
grant execute on function capture_resume_cost_paused(uuid, text, text, text) to anon, authenticated;
grant execute on function capture_claim_jobs_with_frames(integer, text) to anon, authenticated;
grant execute on function capture_claim_jobs_for_session(uuid, integer, text) to anon, authenticated;
grant execute on function capture_session_review(uuid, text) to anon, authenticated;
