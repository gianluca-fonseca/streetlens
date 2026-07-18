-- 0022_segment_synthesis.sql
-- The nuanced verdict lands next to the numbers: after the deterministic rollup,
-- one text-only model call per segment reads the whole traversal in order and
-- writes an assessment an average cannot — a prose verdict, a per-lens
-- explanation, and bounded, reasoned score adjustments. This migration gives that
-- assessment a home and surfaces it to the reviewer.
--
-- Four changes, all additive and all `capture_`-scoped (the database is shared,
-- and this migration touches NOTHING it did not create):
--
--   capture_segment_rollups.assessment  — a new nullable jsonb column, plus two
--                                         nullable synthesis_*_tokens columns so
--                                         the model call's spend is counted in the
--                                         session ledger, not invisible. A rollup
--                                         with no assessment (synthesis skipped,
--                                         disabled, or failed) simply has none;
--                                         nothing backfills them.
--
--   capture_set_segment_assessment      — a new secret-gated write RPC. Synthesis
--                                         runs AFTER the rollup upsert, so this
--                                         updates the assessment (and its token
--                                         counts) onto an existing rollup row
--                                         rather than creating one. A failed
--                                         synthesis never writes, and the column
--                                         stays null and honest.
--
--   capture_list_observations           — the worker read gains each frame's GPS
--                                         position (lng/lat, from the geography
--                                         column) and its rationale, the two
--                                         things the synthesis evidence needs that
--                                         the rollup did not. 0015 shipped it
--                                         without them; a `returns table` cannot
--                                         `create or replace` across a changed
--                                         column list, so it is dropped first and
--                                         recreated.
--
--   capture_session_review              — the admin review read now hangs the
--                                         per-segment `assessment` off each rollup
--                                         entry, so the reviewer sees the nuanced
--                                         verdict beside the scores. Same
--                                         signature, so a plain create-or-replace.
--
-- Idempotent and re-runnable, like the rest of the chain: `add column if not
-- exists`, `drop function if exists` before the recreate, and `create or replace`
-- for the write and the review read.

-- 1. The columns ------------------------------------------------------------

alter table capture_segment_rollups
  add column if not exists assessment jsonb;

-- The synthesis call's spend, so a per-segment text call is counted in the same
-- ledger as the per-frame vision calls rather than being free money nobody sees.
alter table capture_segment_rollups
  add column if not exists synthesis_input_tokens  integer;
alter table capture_segment_rollups
  add column if not exists synthesis_output_tokens integer;

-- 2. The write path ---------------------------------------------------------
--
-- Separate from capture_upsert_rollup on purpose: the rollup is the measurement
-- and is written first; the assessment is a later, independently-fallible step,
-- and coupling them would mean a synthesis failure could not leave the rollup
-- standing on its own. The update matches an existing rollup by (session,
-- segment) and no-ops when there is none, so a race or a stray segment id can
-- never conjure an orphan row.

create or replace function capture_set_segment_assessment(
  p_session_id    uuid,
  p_segment_id    text,
  p_assessment    jsonb,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_secret        text
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

  update capture_segment_rollups
     set assessment              = p_assessment,
         synthesis_input_tokens  = p_input_tokens,
         synthesis_output_tokens = p_output_tokens
   where session_id = p_session_id
     and segment_id = p_segment_id;
end;
$$;

-- 3. Extend the worker read with GPS + rationale ----------------------------
--
-- Synthesis reasons about distance along the walk and reads the per-frame notes,
-- so it needs each frame's position and rationale — neither of which 0015's
-- capture_list_observations returned. lng/lat come from the geography(Point,4326)
-- column cast to geometry; both are null when the frame could not be placed.
-- Adding columns to a `returns table` is a changed signature, so the 0015 version
-- is dropped before the extended one is created.

drop function if exists capture_list_observations(uuid, text);

create or replace function capture_list_observations(
  p_session_id uuid,
  p_secret     text
) returns table (
  frame_id      uuid,
  segment_id    text,
  model         text,
  items         jsonb,
  usable        boolean,
  confidence    numeric,
  escalated     boolean,
  near_junction boolean,
  seq           integer,
  rationale     text,
  lng           double precision,
  lat           double precision
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

  return query
  select o.frame_id, o.segment_id, o.model, o.items, o.usable, o.confidence,
         o.escalated, f.near_junction, f.seq, o.rationale,
         st_x(f.location::geometry) as lng,
         st_y(f.location::geometry) as lat
    from capture_observations o
    join capture_frames f on f.id = o.frame_id
   where f.session_id = p_session_id
   order by f.seq;
end;
$$;

-- 4. Surface the assessment to the review read ------------------------------
--
-- FROZEN CONTRACT (a sibling lane's review UI consumes this shape verbatim; do
-- not rename these keys): every entry in `rollups` gains an `assessment` key:
--
--   assessment: { overall, lenses: { accessibility, drainage, shade, bike },
--                 adjustments: { <lens>: { delta, reason } },
--                 adjustedScores: { overall, accessibility, drainage, shade, bike },
--                 model } | null
--
-- `null` when synthesis did not run or did not succeed for that segment. The
-- adjustedScores are the synthesis engine's bounded correction on the baseline;
-- the raw score_* columns above them are the untouched deterministic rollup, so a
-- reviewer can always see both. Everything else in the payload is unchanged from
-- 0020.

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
        'escalated',    count(*) filter (where o.escalated),
        -- Synthesis spend, summed from the rollups: one small text call per
        -- segment, surfaced beside the per-frame vision spend, never folded into it.
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
        -- The nuanced cross-frame verdict, or null when synthesis did not run.
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

-- 5. Grants -----------------------------------------------------------------
--
-- Same posture as the rest of the chain: secret-gated internally, callable by
-- anon. The dropped-and-recreated capture_list_observations must be re-granted;
-- the new write RPC and the replaced review read are stated for a clean re-run.

revoke all on function capture_set_segment_assessment(uuid, text, jsonb, integer, integer, text) from public;
revoke all on function capture_list_observations(uuid, text) from public;
revoke all on function capture_session_review(uuid, text) from public;

grant execute on function capture_set_segment_assessment(uuid, text, jsonb, integer, integer, text) to anon, authenticated;
grant execute on function capture_list_observations(uuid, text) to anon, authenticated;
grant execute on function capture_session_review(uuid, text) to anon, authenticated;
