-- 0025_pipeline_truth.sql
-- Operational truth for deliberate stops: resume cost_paused sessions, reclaim
-- stale running jobs, persist pause reasons, and surface per-frame job errors in
-- review. Purely additive except for replaced SECURITY DEFINER functions.

/* ------------------------------------------------------------------ *
 * 1. Session pause / resume audit columns
 * ------------------------------------------------------------------ */

alter table capture_sessions
  add column if not exists pause_reason  text,
  add column if not exists resume_actor  text,
  add column if not exists resume_reason text,
  add column if not exists resumed_at    timestamptz;

/* ------------------------------------------------------------------ *
 * 2. Reclaim jobs stuck in `running` after a worker timeout
 * ------------------------------------------------------------------ */

-- Called at the start of every claim RPC so orphaned `running` rows do not
-- block drain forever. Does NOT increment attempts — the claim that follows
-- owns the attempt accounting.
create or replace function capture_reclaim_stale_jobs(
  p_secret text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_count    integer;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  update capture_frame_jobs
     set status     = 'pending',
         updated_at = now()
   where status = 'running'
     and claimed_at < now() - interval '10 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ------------------------------------------------------------------ *
 * 3. Session status write — persist pause_reason on cost_paused
 * ------------------------------------------------------------------ */

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
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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
 * 4. Resume a cost_paused session (operator action)
 * ------------------------------------------------------------------ */

-- Secret-gated. Flips the session back to `extracting`, requeues every
-- `failed_overbudget` job to `pending` (clearing its error), and records who
-- resumed and why. Does NOT touch `failed` frames — those are real failures.
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
  v_expected    text;
  v_status      text;
  v_requeued    integer;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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
    'sessionId',  p_session_id,
    'status',     'extracting',
    'requeued',   v_requeued
  );
end;
$$;

/* ------------------------------------------------------------------ *
 * 5. Claim RPCs — reclaim stale jobs before claiming
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
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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
declare
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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
 * 6. Public status — surface pause reason to contributors
 * ------------------------------------------------------------------ */

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
    'pauseReason', s.pause_reason,
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
 * 7. Admin review — pause reason + per-frame job status/error
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
 * 8. Grants
 * ------------------------------------------------------------------ */

revoke all on function capture_reclaim_stale_jobs(text) from public;
revoke all on function capture_resume_cost_paused(uuid, text, text, text) from public;
revoke all on function capture_set_session_status(uuid, text, text, text) from public;
revoke all on function capture_session_status(uuid) from public;
revoke all on function capture_session_review(uuid, text) from public;
revoke all on function capture_claim_jobs_with_frames(integer, text) from public;
revoke all on function capture_claim_jobs_for_session(uuid, integer, text) from public;

grant execute on function capture_reclaim_stale_jobs(text) to anon, authenticated;
grant execute on function capture_resume_cost_paused(uuid, text, text, text) to anon, authenticated;
grant execute on function capture_set_session_status(uuid, text, text, text) to anon, authenticated;
grant execute on function capture_session_status(uuid) to anon, authenticated;
grant execute on function capture_session_review(uuid, text) to anon, authenticated;
grant execute on function capture_claim_jobs_with_frames(integer, text) to anon, authenticated;
grant execute on function capture_claim_jobs_for_session(uuid, integer, text) to anon, authenticated;
