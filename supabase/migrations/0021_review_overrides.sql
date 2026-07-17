-- 0021_review_overrides.sql (u2 review inspector + overrides)
--
-- Reviewer corrections become part of the record. Three things land here:
--
--   1. Provenance columns on community_cv_observations: human_corrected and a
--      compact `overrides` jsonb, so the map can be honest about a row a person
--      touched and an auditor can see exactly what changed.
--   2. admin_apply_capture_session, extended (create or replace, same signature)
--      to accept and persist those two fields. Backward compatible: a payload
--      that carries neither still applies, defaulting to "pure CV, untouched".
--   3. Two new secret-gated RPCs for the review page's new powers:
--        - capture_delete_frame: the strongest honest hard delete this deployment
--          allows (frame row + storage object), with a tombstone so the record
--          never lies about how many frames a walk had.
--        - capture_session_review_detail: the per-frame geography and quality plus
--          the GPS track, which the public review RPC does not carry. This is the
--          map panel's and the recompute's data source.
--
-- Scope is capture_/community_cv_ only, exactly like 0017/0019. Every function is
-- SECURITY DEFINER and gated on the same app_secrets admin secret; the deployment
-- has no service role, so the secret is the only authorization.

begin;

-- 1. Provenance columns ------------------------------------------------------
-- Defaults matter twice over: existing rows become "not corrected" for free, and
-- the not-yet-updated apply path (or a payload with no overrides) stays valid.

alter table community_cv_observations
  add column if not exists human_corrected boolean not null default false;

alter table community_cv_observations
  add column if not exists overrides jsonb not null default '{}'::jsonb;

comment on column community_cv_observations.human_corrected is
  'True when a reviewer overrode readings, excluded/deleted frames, or hand-edited '
  'a lens score before approving. Surfaced on the map beside the CV chip (u2).';
comment on column community_cv_observations.overrides is
  'Compact audit record of what a reviewer changed: item overrides by frame seq, '
  'excluded and deleted seqs, and manual lens-score edits (u2).';

-- 2. admin_apply_capture_session, extended -----------------------------------
-- Identical to 0017 except the two provenance fields join the insert, the select
-- projection, and the on-conflict update. A payload without them coalesces to the
-- untouched defaults, so old callers and re-approvals keep working.

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
    human_corrected, overrides,
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
        submission_id       = excluded.submission_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 3. Frame tombstones --------------------------------------------------------
-- A hard delete removes a frame's row and bytes. The seq must survive so the
-- review does not silently lie about frame counts; this table is that memory.

create table if not exists capture_frame_tombstones (
  session_id uuid not null references capture_sessions (id) on delete cascade,
  seq        integer not null,
  deleted_at timestamptz not null default now(),
  primary key (session_id, seq)
);

alter table capture_frame_tombstones enable row level security;
-- No policy: only SECURITY DEFINER functions (running as owner) read or write it.

-- 4. capture_delete_frame ----------------------------------------------------
-- The strongest honest hard delete this deployment can offer. Anon has no storage
-- DELETE (0013 leaves frames write-once), so a reviewer cannot delete bytes from
-- the client; this SECURITY DEFINER function, running as owner, can. It removes
-- the storage.objects row (revoking all access) and the capture_frames row (which
-- cascades to its observations and job), and records a tombstone.
--
-- HONEST CAVEAT (documented in docs/cv-funnel.md): deleting the storage.objects
-- row revokes access immediately, but the provider may not garbage-collect the
-- backing bytes instantly. This is the strongest deletion the platform exposes;
-- it is not a guarantee about the provider's block storage.

create or replace function capture_delete_frame(
  p_secret     text,
  p_session_id uuid,
  p_seq        integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected     text;
  v_frame_id     uuid;
  v_storage_path text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select id, storage_path
    into v_frame_id, v_storage_path
    from capture_frames
   where session_id = p_session_id and seq = p_seq;

  -- Idempotent: a frame already gone still yields a tombstone and a truthful
  -- "deleted", so a retried delete does not error.
  insert into capture_frame_tombstones (session_id, seq)
  values (p_session_id, p_seq)
  on conflict (session_id, seq) do nothing;

  if v_frame_id is null then
    return jsonb_build_object('deleted', true, 'seq', p_seq, 'bytesRemoved', false);
  end if;

  delete from storage.objects
   where bucket_id = 'streetlens-frames' and name = v_storage_path;

  -- Cascades to capture_observations and capture_frame_jobs (0013 on delete cascade).
  delete from capture_frames where id = v_frame_id;

  return jsonb_build_object('deleted', true, 'seq', p_seq, 'bytesRemoved', true);
end;
$$;

-- 5. capture_session_review_detail -------------------------------------------
-- The per-frame geography and quality the public review RPC (0017) does not carry,
-- plus the GPS track. The review map draws the track as a polyline and every frame
-- as a numbered dot; the override recompute needs near_junction and usable to
-- reproduce the server rollup exactly (lib/capture/rollup.ts). Kept separate from
-- capture_session_review so the two lanes touching that page never collide.
--
-- usable is read from the observation that would win the rollup (the escalated one
-- if a frame escalated), matching lib/capture/pump.ts. location is interpolated at
-- match time (0013); a frame that matched no street may have none, hence the null.

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
    'tombstones', coalesce(v_tombs, '[]'::jsonb)
  );
end;
$$;

-- 6. Grants — secret-gated, not role-gated (same posture as 0017/0019) --------

revoke all on function capture_delete_frame(text, uuid, integer) from public;
revoke all on function capture_session_review_detail(uuid, text) from public;
grant execute on function capture_delete_frame(text, uuid, integer) to anon, authenticated;
grant execute on function capture_session_review_detail(uuid, text) to anon, authenticated;

commit;
