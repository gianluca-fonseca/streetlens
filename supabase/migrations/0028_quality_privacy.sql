-- 0028_quality_privacy.sql (unit-quality-privacy)
--
-- Two SECURITY-RELEVANT concerns in one migration, clearly sectioned:
--
--   A. Locale-aware camera assessments (EN + ES)
--   B. Private capture-frame bucket + evidence-only public read
--
-- Conductor applies. This file never writes the live database by itself.

/* ================================================================== *
 * A. Locale-aware camera assessments
 *
 * Design: keep `assessment` as the English (frozen) synthesis object and add
 * a sibling `assessment_es` jsonb for Spanish prose only.
 *
 * Why not a locale map inside `assessment`?
 *   - Existing English-only rows and every Zod consumer of SegmentAssessment
 *     keep working without a shape migration or dual-parse path.
 *   - Adjustments / adjustedScores / model are language-neutral and stay on
 *     the EN object; ES stores only { overall, lenses } (the prose that
 *     differs). Public UI falls back to EN when assessment_es is null.
 * ================================================================== */

alter table capture_segment_rollups
  add column if not exists assessment_es jsonb;

comment on column capture_segment_rollups.assessment_es is
  'Spanish prose companion to assessment (overall + lenses). Null when synthesis skipped ES or predated 0028.';

alter table community_cv_observations
  add column if not exists assessment_es jsonb;

comment on column community_cv_observations.assessment_es is
  'Spanish prose companion to assessment. Public surfaces pick viewer locale; fall back to assessment (EN).';

-- Persist both locales from the pump. p_assessment_es is optional (null keeps
-- the EN-only path for older callers / failed ES generation).
--
-- Postgres: adding a DEFAULT arg creates a new overload. Drop the 6-arg form
-- so callers always hit the 7-arg signature (p_assessment_es nullable).
drop function if exists capture_set_segment_assessment(uuid, text, jsonb, integer, integer, text);

create or replace function capture_set_segment_assessment(
  p_session_id    uuid,
  p_segment_id    text,
  p_assessment    jsonb,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_secret        text,
  p_assessment_es jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin_secret(p_secret);

  update capture_segment_rollups
     set assessment              = p_assessment,
         assessment_es           = p_assessment_es,
         synthesis_input_tokens  = p_input_tokens,
         synthesis_output_tokens = p_output_tokens
   where session_id = p_session_id
     and segment_id = p_segment_id;
end;
$$;

revoke all on function capture_set_segment_assessment(uuid, text, jsonb, integer, integer, text, jsonb) from public;
grant execute on function capture_set_segment_assessment(uuid, text, jsonb, integer, integer, text, jsonb) to anon, authenticated;

-- Apply path: carry assessment_es onto published CV observations.
-- Preserves 0026 body; only assessment_es is additive.
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
  v_count    integer;
  v_keep     text[];
begin
  perform assert_admin_secret(p_secret);

  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'p_observations must be a jsonb array';
  end if;

  select coalesce(array_agg(o ->> 'id'), '{}')
    into v_keep
    from jsonb_array_elements(p_observations) as o;

  delete from community_cv_observations
   where session_id = p_session_id
     and not (id = any (v_keep));

  insert into community_cv_observations (
    id, segment_id, session_id,
    score_overall, score_accessibility, score_drainage, score_shade, score_bike,
    item_medians, coverage, confidence, frame_refs, captured_on,
    human_corrected, overrides, assessment, assessment_es,
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
    o -> 'assessment_es',
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
        assessment_es       = excluded.assessment_es,
        submission_id       = excluded.submission_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Review read: 0027 body + assessmentEs on each rollup.
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
        'assessmentEs', r.assessment_es,
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

/* ================================================================== *
 * B. Private capture-frame bucket + evidence-only public read
 *
 * Flip streetlens-frames to private. Contributor INSERT (register-then-upload)
 * stays via capture_frames_anon_insert / capture_frame_upload_allowed — that
 * path does not require a public bucket.
 *
 * Public SELECT is narrowed to paths that already appear on a published
 * community_cv_observations.frame_refs row. That is the only anon-readable
 * set: approved evidence the map panel may show via short-lived signed URLs.
 *
 * Unapproved / in-flight frames have NO select policy. Admin review and the
 * extraction pump mint signed URLs with SUPABASE_SERVICE_ROLE_KEY (app-side).
 * Knowing a session uuid from a WhatsApp status link is no longer enough to
 * fetch raw frames.
 * ================================================================== */

update storage.buckets
   set public = false
 where id = 'streetlens-frames';

-- Is this exact storage path published as approved camera evidence?
create or replace function capture_frame_evidence_readable(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from community_cv_observations o,
           jsonb_array_elements_text(coalesce(o.frame_refs, '[]'::jsonb)) as ref(path)
     where ref.path = p_name
  );
$$;

revoke all on function capture_frame_evidence_readable(text) from public;
grant execute on function capture_frame_evidence_readable(text) to anon, authenticated;

drop policy if exists capture_frames_evidence_select on storage.objects;
create policy capture_frames_evidence_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'streetlens-frames'
    and name ~ '^captures/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/frame-[0-9]{4}\.jpg$'
    and capture_frame_evidence_readable(name)
  );

-- Insert policy from 0016 is unchanged: registration still authorizes upload.
-- No update/delete policies: frames remain write-once.
