-- 0020_observation_rationale.sql
-- One free-text field per frame reaches the reviewer: a short, plain-language
-- note on WHAT the model saw and WHY the notable scores are what they are. It is
-- per FRAME, not per item (one honest paragraph a human reads in seconds, not 15
-- justifications that cost 15x the tokens for little review value).
--
-- Three changes, all additive and all `capture_`-scoped (the database is shared,
-- and this migration touches nothing it did not create):
--
--   capture_observations.rationale  — a new nullable text column. Old rows
--                                     predate the field and simply have none;
--                                     nothing backfills them.
--
--   capture_complete_job            — the worker's write RPC gains a p_rationale
--                                     argument and persists it on insert (and on
--                                     the re-run upsert). 0013 shipped it without
--                                     the column, and 0013 is append-only and
--                                     already applied, so the signature is
--                                     replaced here rather than edited there.
--
--   capture_session_review          — the admin review read (0017) now hangs the
--                                     per-frame observation off each frame, so a
--                                     reviewer sees the readings AND the rationale
--                                     next to the filmstrip. Same signature, so it
--                                     is a plain create-or-replace.
--
-- Idempotent and re-runnable, like the rest of the chain: `add column if not
-- exists`, `drop function if exists` before the recreate, and `create or replace`
-- for the review read.

-- 1. The column -------------------------------------------------------------

alter table capture_observations
  add column if not exists rationale text;

-- 2. Persist the rationale on the write path --------------------------------
--
-- 0013's capture_complete_job took eight value arguments plus the secret and had
-- no place for the rationale. A new argument is a new signature, and Postgres
-- cannot `create or replace` across a changed argument list — it would leave the
-- old overload in place. So the 0013 signature is dropped first and the extended
-- one recreated. p_rationale sits just before p_secret so the secret stays last,
-- matching every other RPC in this chain.

drop function if exists capture_complete_job(
  uuid, text, jsonb, boolean, numeric, integer, integer, boolean, text
);

create or replace function capture_complete_job(
  p_frame_id      uuid,
  p_model         text,
  p_items         jsonb,
  p_usable        boolean,
  p_confidence    numeric,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_escalated     boolean,
  p_rationale     text,
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
    input_tokens, output_tokens, escalated, rationale
  )
  values (
    p_frame_id, v_segment_id, p_model, p_items, coalesce(p_usable, true), p_confidence,
    p_input_tokens, p_output_tokens, coalesce(p_escalated, false), p_rationale
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
        rationale     = excluded.rationale,
        created_at    = now();

  update capture_frame_jobs
     set status = 'done', error = null, updated_at = now()
   where frame_id = p_frame_id;
end;
$$;

-- 3. Surface the per-frame observation to the review read -------------------
--
-- FROZEN CONTRACT (a sibling lane's review UI consumes this shape verbatim; do
-- not rename these keys): every entry in `frames` gains an `observation` key:
--
--   observation: { items: { <rubricKey>: { value, confidence } ... },
--                  rationale, escalated, model } | null
--
-- `null` when the frame has no observation at all (unscored or failed). When a
-- frame escalated it carries two observation rows (the cheap model and the
-- stronger one); the escalated row is the one the reviewer should see, so the
-- pick is `order by escalated desc, created_at desc limit 1` — the same "the
-- escalated answer wins" rule the rollup uses. Everything else in the payload is
-- unchanged from 0017.

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
        'segmentId',   f.segment_id,
        -- null when the frame has no observation (unscored/failed); otherwise the
        -- winning row's readings, its rationale, whether it was escalated, and the
        -- model that produced it.
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
      where f.session_id = p_session_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Grants, mirroring 0013/0017: secret-gated internally, callable by anon. The
-- replaced capture_complete_job signature must be re-granted; the review read
-- keeps its existing grant but is re-stated for a clean re-run.
revoke all on function capture_complete_job(
  uuid, text, jsonb, boolean, numeric, integer, integer, boolean, text, text
) from public;
revoke all on function capture_session_review(uuid, text) from public;
grant execute on function capture_complete_job(
  uuid, text, jsonb, boolean, numeric, integer, integer, boolean, text, text
) to anon, authenticated;
grant execute on function capture_session_review(uuid, text) to anon, authenticated;
