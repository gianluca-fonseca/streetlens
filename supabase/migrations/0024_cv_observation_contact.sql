-- 0024_cv_observation_contact.sql (u-provenance — segment provenance display)
-- Surface WHO submitted an approved camera observation on the public map, so a
-- segment popover can answer "who walked this" alongside "when walked" and "when
-- last updated" (captured_on / created_at, already present).
--
-- Two additive, backward-compatible changes, both scoped to community_cv_ /
-- capture_ objects. Nothing is dropped; an un-upgraded apply payload keeps working.
--
--   1. A nullable `contact` column on community_cv_observations.
--   2. admin_apply_capture_session, redefined to fill `contact` from the SESSION,
--      server-side. The contributor's contact is NOT read from the (client-shaped)
--      observation payload; it is looked up from capture_sessions by the session id
--      the RPC already trusts, so a forged payload cannot spoof or redirect it.
--
-- PRIVACY POSTURE. capture_sessions.contact and source_ip_hash are withheld from
-- every world-readable projection (0013/0017/0019). This migration publishes ONLY
-- contact, ONLY for observations an admin explicitly approved, and ONLY via this
-- admin-secret-gated apply path — a deliberate, per-row publish decision, never the
-- raw session. The ip hash stays withheld. If contact must not be public at all,
-- revert this migration and render every observation as "Anonymous contributor".

begin;

-- 1. The contact column ------------------------------------------------------
-- Nullable, defaulting to NULL: existing rows and any anonymous walk read as "no
-- contact" (the popover shows "Anonymous contributor") for free.

alter table community_cv_observations
  add column if not exists contact text;

comment on column community_cv_observations.contact is
  'The contributor contact from capture_sessions.contact, published at approval '
  'for the public "submitted by" line (u-provenance). Null when anonymous. Only '
  'this admin-approved projection is public; the raw session contact/ip hash are '
  'never world-readable. Sourced server-side in admin_apply_capture_session.';

-- 2. admin_apply_capture_session, extended -----------------------------------
-- Identical to 0023 except `contact` is looked up from capture_sessions (by the
-- trusted p_session_id) and joins the insert select projection and the on-conflict
-- update. Every other column is unchanged, so old callers and re-approvals keep
-- working; a session with a null contact simply stores null.

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
  v_contact  text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'p_observations must be a jsonb array';
  end if;

  -- Server-authoritative: the contributor contact comes from the session, never
  -- the payload, so an approval cannot attach a contact the contributor never gave.
  select contact into v_contact from capture_sessions where id = p_session_id;

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
    human_corrected, overrides, assessment, contact,
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
    v_contact,
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
        contact             = excluded.contact,
        submission_id       = excluded.submission_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 3. capture_session_review_detail, extended ---------------------------------
-- The admin review workbench must show the SAME "submitted by" fact the public
-- popover shows, so reviewer and public read one truth. This detail RPC is the
-- secret-gated (admin-only) companion to the anon-callable capture_session_review,
-- which deliberately withholds contact/ip hash from anyone holding a session link.
-- Adding contact HERE (and not to the anon RPC) keeps that boundary: only an
-- authenticated admin sees it. Identical to 0021 except `contact` joins the return.

create or replace function capture_session_review_detail(
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
  v_frames   jsonb;
  v_tombs    jsonb;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select * into v_session from capture_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session not found';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('lng', st_x(dp.geom), 'lat', st_y(dp.geom))
             order by dp.path
           ),
           '[]'::jsonb
         )
    into v_track
    from st_dumppoints(v_session.track::geometry) as dp;

  select coalesce(jsonb_agg(fr order by (fr ->> 'seq')::int), '[]'::jsonb)
    into v_frames
    from (
      select jsonb_build_object(
        'seq',          f.seq,
        'nearJunction', f.near_junction,
        'usable',       coalesce((
          select o.usable
            from capture_observations o
           where o.frame_id = f.id
           order by o.escalated desc
           limit 1
        ), true),
        'position', case
          when f.location is null then null
          else jsonb_build_object(
            'lng', st_x(f.location::geometry),
            'lat', st_y(f.location::geometry)
          )
        end
      ) as fr
      from capture_frames f
      where f.session_id = p_session_id
    ) frames;

  select coalesce(jsonb_agg(jsonb_build_object('seq', t.seq) order by t.seq), '[]'::jsonb)
    into v_tombs
    from capture_frame_tombstones t
   where t.session_id = p_session_id;

  return jsonb_build_object(
    'track',      coalesce(v_track, '[]'::jsonb),
    'frames',     coalesce(v_frames, '[]'::jsonb),
    'tombstones', coalesce(v_tombs, '[]'::jsonb),
    'contact',    v_session.contact
  );
end;
$$;

commit;
