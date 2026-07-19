-- 0029_ops_deck.sql — fleet observability RPCs for the ops console and health probe.
--
-- Read-mostly aggregates over capture_* tables. All calls are secret-gated via
-- assert_admin_secret (same ADMIN_RPC_SECRET the worker uses). The /api/ops/health
-- route adds a separate OPS_HEALTH_SECRET at the HTTP layer so monitors never
-- need the full admin RPC secret.

/* ------------------------------------------------------------------ *
 * Fleet health snapshot (curlable via /api/ops/health)
 * ------------------------------------------------------------------ */

create or replace function ops_health_summary(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  select jsonb_build_object(
    'cost_paused', (
      select count(*)::integer from capture_sessions where status = 'cost_paused'
    ),
    'stuck_running_jobs', (
      select count(*)::integer from capture_frame_jobs
       where status = 'running'
         and claimed_at < now() - interval '10 minutes'
    ),
    'stuck_extracting_sessions', (
      select count(*)::integer from (
        select s.id
          from capture_sessions s
          join capture_frames f on f.session_id = s.id
          join capture_frame_jobs j on j.frame_id = f.id
         where s.status = 'extracting'
           and j.status in ('pending', 'running')
         group by s.id, s.created_at
        having coalesce(max(j.updated_at), s.created_at) < now() - interval '2 hours'
      ) stuck
    ),
    'failed_jobs', (
      select count(*)::integer from capture_frame_jobs
       where status in ('failed', 'failed_overbudget')
    ),
    'pending_jobs', (
      select count(*)::integer from capture_frame_jobs where status = 'pending'
    ),
    'checked_at', to_jsonb(now())
  ) into v_result;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * Session fleet list + token spend aggregates (bounded)
 * ------------------------------------------------------------------ */

create or replace function ops_fleet_sessions(
  p_secret text,
  p_limit  integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  select coalesce(jsonb_agg(row order by row->>'createdAt' desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'sessionId',   s.id,
        'status',      s.status,
        'mode',        s.mode,
        'frameCount',  s.frame_count,
        'createdAt',   s.created_at,
        'pauseReason', s.pause_reason,
        'jobs', (
          select jsonb_build_object(
            'pending', count(*) filter (where j.status in ('pending', 'running')),
            'done',    count(*) filter (where j.status = 'done'),
            'failed',  count(*) filter (where j.status in ('failed', 'failed_overbudget')),
            'overbudget', count(*) filter (where j.status = 'failed_overbudget')
          )
          from capture_frame_jobs j
          join capture_frames f on f.id = j.frame_id
          where f.session_id = s.id
        ),
        'tokens', (
          select jsonb_build_object(
            'extractionInput',  coalesce(sum(o.input_tokens), 0),
            'extractionOutput', coalesce(sum(o.output_tokens), 0),
            'synthesisInput', coalesce((
              select sum(r.synthesis_input_tokens) from capture_segment_rollups r
               where r.session_id = s.id
            ), 0),
            'synthesisOutput', coalesce((
              select sum(r.synthesis_output_tokens) from capture_segment_rollups r
               where r.session_id = s.id
            ), 0),
            'escalated', coalesce(sum(case when o.escalated then 1 else 0 end), 0),
            'observations', count(o.*)
          )
          from capture_observations o
          join capture_frames f on f.id = o.frame_id
          where f.session_id = s.id
        )
      ) as row
      from capture_sessions s
      order by s.created_at desc
      limit v_limit
    ) sub;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * Daily token spend (extraction + synthesis), last N days
 * ------------------------------------------------------------------ */

create or replace function ops_daily_token_spend(
  p_secret text,
  p_days   integer default 14
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  select coalesce(jsonb_agg(row order by row->>'day'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'day', d.day,
        'extractionInput',  coalesce(e.in_tok, 0),
        'extractionOutput', coalesce(e.out_tok, 0),
        'synthesisInput',   coalesce(syn.in_tok, 0),
        'synthesisOutput',  coalesce(syn.out_tok, 0)
      ) as row
      from (
        select generate_series(
          (current_date - (v_days - 1)),
          current_date,
          interval '1 day'
        )::date as day
      ) d
      left join lateral (
        select
          sum(o.input_tokens)  as in_tok,
          sum(o.output_tokens) as out_tok
        from capture_observations o
        where o.created_at::date = d.day
      ) e on true
      left join lateral (
        select
          sum(r.synthesis_input_tokens)  as in_tok,
          sum(r.synthesis_output_tokens) as out_tok
        from capture_segment_rollups r
        where r.updated_at::date = d.day
          and (r.synthesis_input_tokens is not null or r.synthesis_output_tokens is not null)
      ) syn on true
    ) sub;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * Model quality raw rows (bounded) — aggregated in app code for flexibility
 * ------------------------------------------------------------------ */

create or replace function ops_model_quality_rows(
  p_secret text,
  p_limit  integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  select coalesce(jsonb_agg(row), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'observationId', c.id,
        'sessionId',     c.session_id,
        'segmentId',     c.segment_id,
        'humanCorrected', c.human_corrected,
        'overrides',     c.overrides,
        'model',         coalesce(c.assessment->>'model', (
          select o.model
            from capture_observations o
            join capture_frames f on f.id = o.frame_id
           where f.session_id = c.session_id
             and f.segment_id = c.segment_id
           group by o.model
           order by count(*) desc
           limit 1
        ), 'unknown'),
        'createdAt', c.created_at
      ) as row
      from community_cv_observations c
      order by c.created_at desc
      limit v_limit
    ) sub;

  return v_result;
end;
$$;

/* ------------------------------------------------------------------ *
 * Extraction escalation rates by model (bounded scan)
 * ------------------------------------------------------------------ */

create or replace function ops_extraction_model_stats(
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  select coalesce(jsonb_agg(row order by row->>'model'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'model',     o.model,
        'total',     count(*)::integer,
        'escalated', count(*) filter (where o.escalated)::integer,
        'inputTokens',  coalesce(sum(o.input_tokens), 0)::bigint,
        'outputTokens', coalesce(sum(o.output_tokens), 0)::bigint
      ) as row
      from capture_observations o
      group by o.model
    ) sub;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function ops_health_summary(text) from public;
revoke all on function ops_fleet_sessions(text, integer) from public;
revoke all on function ops_daily_token_spend(text, integer) from public;
revoke all on function ops_model_quality_rows(text, integer) from public;
revoke all on function ops_extraction_model_stats(text) from public;

grant execute on function ops_health_summary(text) to anon, authenticated;
grant execute on function ops_fleet_sessions(text, integer) to anon, authenticated;
grant execute on function ops_daily_token_spend(text, integer) to anon, authenticated;
grant execute on function ops_model_quality_rows(text, integer) to anon, authenticated;
grant execute on function ops_extraction_model_stats(text) to anon, authenticated;
