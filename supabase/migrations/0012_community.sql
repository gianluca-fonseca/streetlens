-- 0012_community.sql
-- Community contributions enter the dataset (u7, advisor ruling 3).
--
-- Approved add_segment submissions and admin bulk imports become rows in
-- community_segments (NO rubric scores — these render with the neutral casing
-- until a field audit verifies them). Approved update_segment submissions become
-- community_reports attached to a target segment. Both tables are publicly
-- readable open data; writes happen ONLY through the SECURITY DEFINER RPCs below
-- (same secret-gated pattern as 0007/0010 — the deployment has no service role).

-- 1. Tables ----------------------------------------------------------------

create table if not exists community_segments (
  id            text primary key,
  name          text not null,
  highway       text not null,
  district      text not null,
  source        text not null check (source in ('community', 'import')),
  verified      boolean not null default false,
  -- Auditor name for a verified field-team import; null otherwise.
  auditor       text,
  -- Provenance back to the originating submission (community adds); null imports.
  submission_id uuid references submissions (id) on delete set null,
  geom          geometry (LineString, 4326) not null,
  created_at    timestamptz not null default now()
);

create index if not exists community_segments_geom_gix
  on community_segments using gist (geom);
create index if not exists community_segments_source_ix
  on community_segments (source);

create table if not exists community_reports (
  id            text primary key,
  -- The target segment: an audited segments.id OR a community_segments.id.
  -- Intentionally NOT a foreign key (two possible parents); the app resolves it.
  segment_id    text not null,
  note          text not null,
  submission_id uuid references submissions (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists community_reports_segment_ix
  on community_reports (segment_id);

-- 2. RLS: published open data (public SELECT); writes only via definer RPCs ---

alter table community_segments enable row level security;
alter table community_reports  enable row level security;

create policy community_segments_public_read on community_segments
  for select to anon, authenticated using (true);
create policy community_reports_public_read on community_reports
  for select to anon, authenticated using (true);
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER functions (running
-- as owner) may write, and each authenticates the admin secret internally.

-- 3. Apply one approved submission ------------------------------------------
-- Called by the admin approve action (after admin_review_submission). Idempotent
-- (ids derive from the submission id; upsert on conflict). NEVER writes a score.

create or replace function admin_apply_submission(
  p_submission_id uuid,
  p_secret        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_sub      submissions;
  v_seg_id   text;
  v_note     text;
  v_name     text;
  v_highway  text;
  v_reason   text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  select * into v_sub from submissions where id = p_submission_id;
  if v_sub.id is null then
    raise exception 'submission not found';
  end if;

  if v_sub.type = 'add_segment' then
    v_seg_id := 'com-' || p_submission_id::text;
    insert into community_segments
      (id, name, highway, district, source, verified, auditor, submission_id, geom, created_at)
    values (
      v_seg_id,
      v_sub.payload ->> 'name',
      v_sub.payload ->> 'highway',
      'Escazú',
      'community',
      false,
      null,
      p_submission_id,
      st_setsrid(
        st_geomfromgeojson(
          jsonb_build_object(
            'type', 'LineString',
            'coordinates', v_sub.payload -> 'coordinates'
          )::text
        ),
        4326
      ),
      now()
    )
    on conflict (id) do update
      set name = excluded.name, highway = excluded.highway, geom = excluded.geom;

    v_note := v_sub.payload ->> 'note';
    if v_note is not null and length(trim(v_note)) > 0 then
      insert into community_reports (id, segment_id, note, submission_id, created_at)
      values ('rep-' || p_submission_id::text, v_seg_id, v_note, p_submission_id, now())
      on conflict (id) do update set note = excluded.note;
    end if;

  elsif v_sub.type = 'update_segment' then
    v_reason  := v_sub.payload ->> 'reason';
    v_name    := v_sub.payload -> 'patch' ->> 'name';
    v_highway := v_sub.payload -> 'patch' ->> 'highway';
    v_note := trim(concat_ws(' ',
      nullif(concat_ws(', ',
        case when v_name    is not null then 'Proposed name → "' || v_name || '"' end,
        case when v_highway is not null then 'highway → ' || v_highway end
      ), ''),
      v_reason
    ));
    insert into community_reports (id, segment_id, note, submission_id, created_at)
    values (
      'rep-' || p_submission_id::text,
      v_sub.payload ->> 'segment_id',
      v_note,
      p_submission_id,
      now()
    )
    on conflict (id) do update
      set note = excluded.note, segment_id = excluded.segment_id;
  else
    raise exception 'unsupported submission type: %', v_sub.type;
  end if;
end;
$$;

-- 4. Apply a batch of bulk-import segments ----------------------------------
-- Called by the admin bulk import commit step. p_features is the array of
-- already-built community segment objects (id/name/highway/district/source/
-- verified/coordinates/created_at). Idempotent upsert by id.

create or replace function admin_import_segments(
  p_secret   text,
  p_features jsonb,
  p_verified boolean,
  p_auditor  text
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

  with inserted as (
    insert into community_segments
      (id, name, highway, district, source, verified, auditor, submission_id, geom, created_at)
    select
      f ->> 'id',
      f ->> 'name',
      f ->> 'highway',
      coalesce(f ->> 'district', 'Escazú'),
      'import',
      coalesce(p_verified, false),
      case when coalesce(p_verified, false) then p_auditor else null end,
      null,
      st_setsrid(
        st_geomfromgeojson(
          jsonb_build_object('type', 'LineString', 'coordinates', f -> 'coordinates')::text
        ),
        4326
      ),
      coalesce((f ->> 'created_at')::timestamptz, now())
    from jsonb_array_elements(p_features) as f
    on conflict (id) do update
      set name = excluded.name, highway = excluded.highway,
          verified = excluded.verified, auditor = excluded.auditor,
          geom = excluded.geom
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

-- Secret-gated, not role-gated: callable by anon/authenticated but each function
-- enforces the admin secret internally.
revoke all on function admin_apply_submission(uuid, text) from public;
revoke all on function admin_import_segments(text, jsonb, boolean, text) from public;
grant execute on function admin_apply_submission(uuid, text) to anon, authenticated;
grant execute on function admin_import_segments(text, jsonb, boolean, text) to anon, authenticated;
