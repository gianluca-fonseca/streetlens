-- 0023_assessment_apply.sql (u2 segment synthesis — apply + map)
--
-- The segment synthesis becomes part of an approved record. Two things land here:
--
--   1. An `assessment` jsonb column on community_cv_observations (nullable), so an
--      approved camera observation carries the reviewer's chosen synthesis (overall
--      verdict, per-lens explanations, adjustments) alongside its numbers. The
--      public segment popover reads the overall text, labeled as model-written.
--   2. admin_apply_capture_session, extended (create or replace, same signature) to
--      accept and persist it. Backward compatible: a payload with no `assessment`
--      coalesces to NULL — "no synthesis" — exactly as a pre-0023 caller sends.
--
-- The sibling lane owns migration 0022 (the engine that WRITES the synthesis onto
-- capture_session_review); this migration owns only what the reviewer approves and
-- the public sees. Scope is community_cv_ / capture_ only, same posture as 0021:
-- SECURITY DEFINER, gated on the same app_secrets admin secret.
--
-- The reviewer's chosen numbers remain the only numbers on the map (seed seal #4).
-- The assessment is context; it never feeds a score_* column.

begin;

-- 1. The assessment column ---------------------------------------------------
-- Nullable, defaulting to NULL: existing rows and any un-upgraded apply payload
-- read as "no synthesis" for free, so nothing that predates this breaks.

alter table community_cv_observations
  add column if not exists assessment jsonb;

comment on column community_cv_observations.assessment is
  'The segment synthesis a reviewer approved (u2): overall verdict, per-lens '
  'explanations, bounded adjustments, and the model. Context only — the public '
  'popover shows the overall text as model-written; it never feeds a score_*.';

-- 2. admin_apply_capture_session, extended -----------------------------------
-- Identical to 0021 except `assessment` joins the insert, the select projection,
-- and the on-conflict update. A payload without it stores NULL, so old callers,
-- re-approvals, and a walk with no synthesis all keep working.

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
    human_corrected, overrides, assessment,
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
    coalesce((o ->> 'human_corrected')::boolean, false),
    coalesce(o -> 'overrides', '{}'::jsonb),
    o -> 'assessment',
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
        human_corrected     = excluded.human_corrected,
        overrides           = excluded.overrides,
        assessment          = excluded.assessment,
        submission_id       = excluded.submission_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;
