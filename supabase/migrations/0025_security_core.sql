-- 0025_security_core.sql
-- Close the PostgREST bypass on capture create/register/finalize and submissions
-- INSERT; hash admin_rpc_secret at rest with constant-time compare; DB-side
-- submission rate limits. Server-only callers pass ADMIN_RPC_SECRET from Next.js.

/* ------------------------------------------------------------------ *
 * 1. Secret helpers
 * ------------------------------------------------------------------ */

-- Constant-time SHA-256 compare against the hex digest stored in app_secrets.
-- Callers pass the plaintext secret; the stored value is always a 64-char hex
-- digest (migration below rewrites any legacy plaintext row).
create or replace function assert_admin_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected bytea;
  v_provided bytea;
  v_diff     integer := 0;
  i          integer;
begin
  select decode(value, 'hex') into v_expected
    from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null then
    raise exception 'unauthorized';
  end if;
  v_provided := digest(p_secret, 'sha256');
  if length(v_provided) <> length(v_expected) then
    raise exception 'unauthorized';
  end if;
  for i in 0..length(v_provided) - 1 loop
    v_diff := v_diff | (get_byte(v_provided, i) # get_byte(v_expected, i));
  end loop;
  if v_diff <> 0 then
    raise exception 'unauthorized';
  end if;
end;
$$;

-- Rewrite legacy plaintext secrets to SHA-256 hex at rest.
update app_secrets
   set value = encode(digest(value, 'sha256'), 'hex')
 where key = 'admin_rpc_secret'
   and value !~ '^[0-9a-f]{64}$';

/* ------------------------------------------------------------------ *
 * 2. Track hygiene (defense in depth for finalize)
 * ------------------------------------------------------------------ */

create or replace function validate_capture_track(p_track jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_count   integer;
  v_min_t   bigint;
  v_max_t   bigint;
  v_span_ms bigint;
  v_lat     double precision;
  v_lng     double precision;
  v_prev_lat double precision;
  v_prev_lng double precision;
  v_prev_t   bigint;
  v_dist_m   double precision;
  v_dt_s     double precision;
  v_speed    double precision;
  p          record;
begin
  if jsonb_typeof(p_track) <> 'array' then
    raise exception 'invalid_track';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_track);
  if v_count < 2 then
    raise exception 'invalid_track';
  end if;

  -- Costa Rica bbox (matches lib/capture/schemas.ts).
  for p in select * from jsonb_array_elements(p_track) with ordinality as x(pt, ord) loop
    v_lat := (p.pt->>'lat')::double precision;
    v_lng := (p.pt->>'lng')::double precision;
    if v_lat is null or v_lng is null
       or v_lat < 8 or v_lat > 11.5
       or v_lng < -86 or v_lng > -82 then
      raise exception 'invalid_track';
    end if;
    -- Drop fixes worse than 25 m accuracy when reported.
    if p.pt ? 'accuracy'
       and nullif(p.pt->>'accuracy', '') is not null
       and (p.pt->>'accuracy')::double precision > 25 then
      raise exception 'invalid_track';
    end if;
  end loop;

  -- After accuracy filter, still need at least two usable fixes.
  select count(*) into v_count
    from jsonb_array_elements(p_track) as pt
   where not (pt ? 'accuracy'
              and nullif(pt->>'accuracy', '') is not null
              and (pt->>'accuracy')::double precision > 25);
  if v_count < 2 then
    raise exception 'invalid_track';
  end if;

  select min((pt->>'t')::bigint), max((pt->>'t')::bigint)
    into v_min_t, v_max_t
    from jsonb_array_elements(p_track) as pt
   where not (pt ? 'accuracy'
              and nullif(pt->>'accuracy', '') is not null
              and (pt->>'accuracy')::double precision > 25);
  v_span_ms := v_max_t - v_min_t;

  -- Live-style floors: at least 10 fixes over 30 s when timestamps are present.
  if v_count >= 10 and v_span_ms < 30000 then
    raise exception 'invalid_track';
  end if;

  -- Max plausible speed between consecutive fixes: 15 m/s (~54 km/h).
  v_prev_lat := null;
  v_prev_lng := null;
  v_prev_t := null;
  for p in
    select (pt->>'lat')::double precision as lat,
           (pt->>'lng')::double precision as lng,
           (pt->>'t')::bigint as t
      from jsonb_array_elements(p_track) as pt
     where not (pt ? 'accuracy'
                and nullif(pt->>'accuracy', '') is not null
                and (pt->>'accuracy')::double precision > 25)
     order by (pt->>'t')::bigint
  loop
    if v_prev_lat is not null and v_prev_t is not null and p.t > v_prev_t then
      v_dist_m := 111320 * sqrt(
        power((p.lat - v_prev_lat) * cos(radians(v_prev_lat)), 2) +
        power(p.lng - v_prev_lng, 2)
      );
      v_dt_s := (p.t - v_prev_t)::double precision / 1000.0;
      if v_dt_s > 0 then
        v_speed := v_dist_m / v_dt_s;
        if v_speed > 15 then
          raise exception 'invalid_track';
        end if;
      end if;
    end if;
    v_prev_lat := p.lat;
    v_prev_lng := p.lng;
    v_prev_t := p.t;
  end loop;
end;
$$;

/* ------------------------------------------------------------------ *
 * 3. Capture RPCs — server-secret gated (old signatures dropped)
 * ------------------------------------------------------------------ */

drop function if exists capture_create_session(text, text, text);
drop function if exists capture_register_frames(uuid, jsonb);
drop function if exists capture_finalize_session(uuid, jsonb, integer);

create or replace function capture_create_session(
  p_mode    text,
  p_ip_hash text,
  p_contact text,
  p_secret  text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
  v_id     uuid;
begin
  perform assert_admin_secret(p_secret);

  if p_mode not in ('live', 'video') then
    raise exception 'invalid mode: %', p_mode;
  end if;

  -- No null ip hash bypass: server always supplies a hashed origin.
  if p_ip_hash is null or btrim(p_ip_hash) = '' then
    raise exception 'rate_limited';
  end if;

  select count(*) into v_recent
    from capture_sessions
   where source_ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    raise exception 'rate_limited';
  end if;

  insert into capture_sessions (mode, source_ip_hash, contact)
  values (p_mode, p_ip_hash, nullif(btrim(p_contact), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function capture_register_frames(
  p_session_id uuid,
  p_frames     jsonb,
  p_secret     text
) returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_accepted integer[];
begin
  perform assert_admin_secret(p_secret);

  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status not in ('pending_upload', 'uploading') then
    raise exception 'session does not accept uploads (status %)', v_status;
  end if;

  if jsonb_typeof(p_frames) <> 'array' then
    raise exception 'frames must be a json array';
  end if;

  if (
    select count(*) from capture_frames where session_id = p_session_id
  ) + jsonb_array_length(p_frames) > 400 then
    raise exception 'frame limit exceeded';
  end if;

  insert into capture_frames (
    session_id, seq, storage_path, t, width, height, bytes, blur_score
  )
  select
    p_session_id,
    (f->>'seq')::integer,
    'captures/' || p_session_id::text || '/frame-' || lpad(f->>'seq', 4, '0') || '.jpg',
    (f->>'t')::bigint,
    (f->>'width')::integer,
    (f->>'height')::integer,
    (f->>'bytes')::integer,
    nullif(f->>'blurScore', '')::double precision
  from jsonb_array_elements(p_frames) as f
  on conflict (session_id, seq) do nothing;

  update capture_sessions
     set status      = case when status = 'pending_upload' then 'uploading' else status end,
         frame_count = (select count(*) from capture_frames where session_id = p_session_id)
   where id = p_session_id;

  select array_agg(seq order by seq) into v_accepted
    from capture_frames where session_id = p_session_id;

  return coalesce(v_accepted, array[]::integer[]);
end;
$$;

create or replace function capture_finalize_session(
  p_session_id      uuid,
  p_track           jsonb,
  p_clock_offset_ms integer,
  p_secret          text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin_secret(p_secret);
  perform validate_capture_track(p_track);

  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status not in ('pending_upload', 'uploading') then
    raise exception 'session already finalized (status %)', v_status;
  end if;

  update capture_sessions
     set track           = st_geogfromtext(
                             'SRID=4326;LINESTRING(' || (
                               select string_agg(
                                        (p->>'lng') || ' ' || (p->>'lat'),
                                        ',' order by ord
                                      )
                                 from jsonb_array_elements(p_track) with ordinality as x(p, ord)
                             ) || ')'
                           ),
         clock_offset_ms = coalesce(p_clock_offset_ms, 0),
         status          = 'matching',
         uploaded_at     = coalesce(uploaded_at, now())
   where id = p_session_id;

  insert into capture_frame_jobs (frame_id)
  select id from capture_frames where session_id = p_session_id
  on conflict (frame_id) do nothing;

  return 'matching';
end;
$$;

revoke all on function capture_create_session(text, text, text, text) from public;
revoke all on function capture_register_frames(uuid, jsonb, text) from public;
revoke all on function capture_finalize_session(uuid, jsonb, integer, text) from public;
grant execute on function capture_create_session(text, text, text, text) to anon, authenticated;
grant execute on function capture_register_frames(uuid, jsonb, text) to anon, authenticated;
grant execute on function capture_finalize_session(uuid, jsonb, integer, text) to anon, authenticated;

/* ------------------------------------------------------------------ *
 * 4. Submissions — kill anon INSERT, secret-gated submit RPC
 * ------------------------------------------------------------------ */

drop policy if exists submissions_anon_insert on submissions;

create index if not exists submissions_ip_ix
  on submissions (source_ip_hash, created_at desc);

create or replace function submit_proposal(
  p_type              text,
  p_payload           jsonb,
  p_status            text,
  p_source_ip_hash    text,
  p_honeypot_tripped  boolean,
  p_secret            text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
  v_id     uuid;
begin
  perform assert_admin_secret(p_secret);

  if p_type not in ('add_segment', 'update_segment', 'cv_capture', 'unknown') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_status not in ('pending', 'rejected') then
    raise exception 'invalid status: %', p_status;
  end if;

  -- Rate limit pending proposals: 20/hour per origin (DB truth, like capture).
  if p_status = 'pending' and not coalesce(p_honeypot_tripped, false) then
    if p_source_ip_hash is null or btrim(p_source_ip_hash) = '' then
      raise exception 'rate_limited';
    end if;
    select count(*) into v_recent
      from submissions
     where source_ip_hash = p_source_ip_hash
       and status = 'pending'
       and honeypot_tripped = false
       and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
      raise exception 'rate_limited';
    end if;
  end if;

  insert into submissions (type, payload, status, source_ip_hash, honeypot_tripped)
  values (p_type, p_payload, p_status, p_source_ip_hash, coalesce(p_honeypot_tripped, false))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function submit_proposal(text, jsonb, text, text, boolean, text) from public;
grant execute on function submit_proposal(text, jsonb, text, text, boolean, text) to anon, authenticated;

/* ------------------------------------------------------------------ *
 * 5. Privileged RPCs — switch to assert_admin_secret (hashed at rest)
 * ------------------------------------------------------------------ */
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

create or replace function admin_apply_submission(
  p_submission_id uuid,
  p_secret        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      submissions;
  v_seg_id   text;
  v_note     text;
  v_name     text;
  v_highway  text;
  v_reason   text;
begin
  perform assert_admin_secret(p_secret);

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
  v_count    integer;
begin
  perform assert_admin_secret(p_secret);

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

create or replace function admin_list_submissions(
  p_secret        text,
  p_status_filter text default 'pending'
) returns table (
  id            uuid,
  type          text,
  payload       jsonb,
  status        text,
  created_at    timestamptz,
  reviewed_at   timestamptz,
  reviewer_note text
)
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  if p_status_filter is not null
     and p_status_filter not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid status filter: %', p_status_filter;
  end if;

  return query
    select s.id, s.type, s.payload, s.status, s.created_at, s.reviewed_at, s.reviewer_note
    from submissions s
    where p_status_filter is null or s.status = p_status_filter
    order by s.created_at desc
    limit 200;
end;
$$;

create or replace function admin_review_submission(
  p_submission_id uuid,
  p_action        text,
  p_reason        text,
  p_secret        text
) returns submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      submissions;
begin
  perform assert_admin_secret(p_secret);

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action: %', p_action;
  end if;

  update submissions
     set status        = case when p_action = 'approve' then 'approved' else 'rejected' end,
         reviewed_at   = now(),
         reviewer_note = p_reason
   where id = p_submission_id
     and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'submission not found or already reviewed';
  end if;

  return v_row;
end;
$$;

create or replace function admin_stats(p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   json;
begin
  perform assert_admin_secret(p_secret);

  select json_build_object(
    'segments',              (select count(*) from segments),
    'audits',                (select count(*) from audits),
    'submissions_pending',   (select count(*) from submissions where status = 'pending'),
    'submissions_approved',  (select count(*) from submissions where status = 'approved'),
    'submissions_rejected',  (select count(*) from submissions where status = 'rejected')
  ) into v_result;

  return v_result;
end;
$$;

create or replace function capture_attribute_frames(
  p_session_id    uuid,
  p_attributions  jsonb,
  p_secret        text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count    integer;
begin
  perform assert_admin_secret(p_secret);

  if jsonb_typeof(p_attributions) <> 'array' then
    raise exception 'attributions must be a json array';
  end if;

  with a as (
    select
      (x->>'seq')::integer            as seq,
      nullif(x->>'segmentId', '')     as segment_id,
      coalesce((x->>'nearJunction')::boolean, false) as near_junction,
      nullif(x->>'lng', '')::double precision as lng,
      nullif(x->>'lat', '')::double precision as lat
    from jsonb_array_elements(p_attributions) as x
  )
  update capture_frames f
     set segment_id    = a.segment_id,
         near_junction = a.near_junction,
         location      = case
                           when a.lng is null or a.lat is null then null
                           else st_setsrid(st_makepoint(a.lng, a.lat), 4326)::geography
                         end
    from a
   where f.session_id = p_session_id
     and f.seq = a.seq;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function capture_claim_jobs(
  p_limit  integer,
  p_secret text
) returns setof capture_frame_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  return query
  with claimed as (
    select j.id
      from capture_frame_jobs j
     where j.status = 'pending'
     order by j.created_at
     limit greatest(coalesce(p_limit, 1), 1)
     for update skip locked
  )
  update capture_frame_jobs j
     set status     = 'running',
         attempts   = j.attempts + 1,
         claimed_at = now(),
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
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
begin
  perform assert_admin_secret(p_secret);

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
begin
  perform assert_admin_secret(p_secret);

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

create or replace function capture_close_review(
  p_session_id uuid,
  p_action     text,
  p_reason     text,
  p_secret     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
begin
  perform assert_admin_secret(p_secret);

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action: %', p_action;
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required';
  end if;

  v_status := case when p_action = 'approve' then 'approved' else 'rejected' end;

  update capture_sessions
     set status      = v_status,
         reviewed_at = now()
   where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  update submissions
     set status        = v_status,
         reviewed_at   = now(),
         reviewer_note = trim(p_reason)
   where type = 'cv_capture'
     and payload ->> 'session_id' = p_session_id::text;
end;
$$;

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
  v_segment_id text;
begin
  perform assert_admin_secret(p_secret);

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
  v_frame_id     uuid;
  v_storage_path text;
begin
  perform assert_admin_secret(p_secret);

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

create or replace function capture_drained_sessions(
  p_limit  integer,
  p_secret text
) returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  return query
  select s.id
    from capture_sessions s
   where s.status = 'extracting'
     and not exists (
       select 1
         from capture_frame_jobs j
         join capture_frames f on f.id = j.frame_id
        where f.session_id = s.id
          and j.status in ('pending', 'running')
     )
   order by s.created_at
   limit greatest(coalesce(p_limit, 1), 1);
end;
$$;

create or replace function capture_emit_submission(
  p_session_id uuid,
  p_secret     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists   boolean;
begin
  perform assert_admin_secret(p_secret);

  select exists (select 1 from capture_sessions where id = p_session_id)
    into v_exists;
  if not v_exists then
    raise exception 'session not found';
  end if;

  -- The unique index above is what makes this safe under concurrent pumps; the
  -- on-conflict is how we decline to care that we lost the race.
  insert into submissions (type, payload, status, source_ip_hash, honeypot_tripped)
  values (
    'cv_capture',
    jsonb_build_object('session_id', p_session_id::text),
    'pending',
    null,
    false
  )
  on conflict do nothing;
end;
$$;

create or replace function capture_fail_job(
  p_frame_id uuid,
  p_status   text,
  p_error    text,
  p_secret   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  if p_status not in ('failed', 'failed_overbudget', 'pending') then
    raise exception 'invalid job status: %', p_status;
  end if;

  update capture_frame_jobs
     set status = p_status, error = left(p_error, 2000), updated_at = now()
   where frame_id = p_frame_id;
end;
$$;

create or replace function capture_fail_unattributed_jobs(
  p_session_id uuid,
  p_secret     text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count    integer;
begin
  perform assert_admin_secret(p_secret);

  update capture_frame_jobs j
     set status     = 'failed',
         error      = 'no_segment_match',
         updated_at = now()
    from capture_frames f
   where f.id = j.frame_id
     and f.session_id = p_session_id
     and f.segment_id is null
     and j.status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function capture_list_frames(
  p_session_id uuid,
  p_secret     text
) returns table (
  id            uuid,
  seq           integer,
  t             bigint,
  storage_path  text,
  segment_id    text,
  near_junction boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  return query
  select f.id, f.seq, f.t, f.storage_path, f.segment_id, f.near_junction
    from capture_frames f
   where f.session_id = p_session_id
   order by f.seq;
end;
$$;

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
begin
  perform assert_admin_secret(p_secret);

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

create or replace function capture_pending_job_count(
  p_secret text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count    integer;
begin
  perform assert_admin_secret(p_secret);

  select count(*) into v_count
    from capture_frame_jobs j
    join capture_frames f   on f.id = j.frame_id
    join capture_sessions s on s.id = f.session_id
   where j.status = 'pending'
     and s.status = 'extracting';

  return coalesce(v_count, 0);
end;
$$;

create or replace function capture_reprocess_session(
  p_session_id   uuid,
  p_attributions jsonb,
  p_secret       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_targets       uuid[];
  v_matched_now   integer;
  v_still         integer;
  v_new_status    text;
begin
  perform assert_admin_secret(p_secret);

  if jsonb_typeof(p_attributions) <> 'array' then
    raise exception 'attributions must be a json array';
  end if;

  select status into v_status from capture_sessions where id = p_session_id;
  if v_status is null then
    raise exception 'session not found';
  end if;
  if v_status in ('approved', 'rejected') then
    raise exception 'session already decided (status %); a decided walk is not a retry target', v_status;
  end if;
  if v_status not in ('extracting', 'review_ready') then
    raise exception 'session not reprocessable (status %); expected extracting or review_ready', v_status;
  end if;

  -- Reject a payload that names a frame the session does not have: a caller that
  -- is confused about which session it is reprocessing must fail loudly here
  -- rather than silently attribute nothing.
  if exists (
    select 1
      from jsonb_array_elements(p_attributions) as x
     where not exists (
       select 1 from capture_frames f
        where f.session_id = p_session_id
          and f.seq = (x->>'seq')::integer
     )
  ) then
    raise exception 'attribution references frames not in session %', p_session_id;
  end if;

  -- Snapshot the target frames BEFORE any mutation: the session's frames whose
  -- job is failed on no_segment_match. Everything below is scoped to these.
  select coalesce(array_agg(f.id), '{}')
    into v_targets
    from capture_frames f
    join capture_frame_jobs j on j.frame_id = f.id
   where f.session_id = p_session_id
     and j.status = 'failed'
     and j.error  = 'no_segment_match';

  -- (a) Re-attribute the target frames from the fresh payload. A null segmentId
  -- is a first-class answer (still off-network) and is stored as null.
  with a as (
    select
      (x->>'seq')::integer                          as seq,
      nullif(x->>'segmentId', '')                   as segment_id,
      coalesce((x->>'nearJunction')::boolean, false) as near_junction
    from jsonb_array_elements(p_attributions) as x
  )
  update capture_frames f
     set segment_id    = a.segment_id,
         near_junction = a.near_junction
    from a
   where f.id = any (v_targets)
     and f.seq = a.seq;

  -- (b) Re-queue only the target frames that now have a segment: their job goes
  -- back to pending with the error cleared, so the pump claims them next drain.
  with matched as (
    update capture_frame_jobs j
       set status     = 'pending',
           error      = null,
           updated_at = now()
      from capture_frames f
     where j.frame_id = f.id
       and f.id = any (v_targets)
       and f.segment_id is not null
    returning j.id
  )
  select count(*) into v_matched_now from matched;

  -- The target frames still off-network stay failed on no_segment_match (they are
  -- already in that state; nothing to write). Report the count for the operator.
  v_still := coalesce(array_length(v_targets, 1), 0) - v_matched_now;

  -- (c) Hand the session back to the pump only when there is fresh work. Nothing
  -- matched => nothing changes, the truest form of a safe no-op.
  if v_matched_now > 0 then
    update capture_sessions
       set status     = 'extracting',
           matched_at = now()
     where id = p_session_id;
    v_new_status := 'extracting';
  else
    v_new_status := v_status;
  end if;

  return jsonb_build_object(
    'reprocessed',   coalesce(array_length(v_targets, 1), 0),
    'matchedNow',    v_matched_now,
    'stillUnmatched', v_still,
    'requeued',      v_matched_now,
    'status',        v_new_status,
    'noop',          (v_matched_now = 0)
  );
end;
$$;

create or replace function capture_session_review(
  p_session_id uuid,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  capture_sessions;
  v_result   jsonb;
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

create or replace function capture_session_review_detail(
  p_session_id uuid,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  capture_sessions;
  v_track    jsonb;
  v_frames   jsonb;
  v_tombs    jsonb;
begin
  perform assert_admin_secret(p_secret);

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

  -- `contact` is admin-only and rides on this secret-gated read alone. Null when the
  -- walk was submitted anonymously. The ip hash is NEVER returned.
  return jsonb_build_object(
    'track',      coalesce(v_track, '[]'::jsonb),
    'frames',     coalesce(v_frames, '[]'::jsonb),
    'tombstones', coalesce(v_tombs, '[]'::jsonb),
    'contact',    v_session.contact
  );
end;
$$;

create or replace function capture_session_token_usage(
  p_session_id uuid,
  p_secret     text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   json;
begin
  perform assert_admin_secret(p_secret);

  select json_build_object(
    'inputTokens',  coalesce(sum(o.input_tokens), 0),
    'outputTokens', coalesce(sum(o.output_tokens), 0),
    'observations', count(*),
    'escalated',    coalesce(sum(case when o.escalated then 1 else 0 end), 0)
  ) into v_result
    from capture_observations o
    join capture_frames f on f.id = o.frame_id
   where f.session_id = p_session_id;

  return coalesce(v_result, json_build_object(
    'inputTokens', 0, 'outputTokens', 0, 'observations', 0, 'escalated', 0
  ));
end;
$$;

create or replace function capture_session_track(
  p_session_id uuid,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  capture_sessions;
  v_track    jsonb;
begin
  perform assert_admin_secret(p_secret);

  select * into v_session from capture_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session not found';
  end if;

  -- st_dumppoints on the geography (cast to geometry) yields the vertices in
  -- path order; coalesce so a session that never finalized returns [] not null.
  select coalesce(
           jsonb_agg(
             jsonb_build_object('lng', st_x(dp.geom), 'lat', st_y(dp.geom))
             order by dp.path
           ),
           '[]'::jsonb
         )
    into v_track
    from st_dumppoints(v_session.track::geometry) as dp;

  return jsonb_build_object(
    'status',     v_session.status,
    'mode',       v_session.mode,
    'frameCount', v_session.frame_count,
    'track',      coalesce(v_track, '[]'::jsonb)
  );
end;
$$;

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
begin
  perform assert_admin_secret(p_secret);

  update capture_segment_rollups
     set assessment              = p_assessment,
         synthesis_input_tokens  = p_input_tokens,
         synthesis_output_tokens = p_output_tokens
   where session_id = p_session_id
     and segment_id = p_segment_id;
end;
$$;

create or replace function capture_set_session_status(
  p_session_id uuid,
  p_status     text,
  p_secret     text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  update capture_sessions
     set status       = p_status,
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

create or replace function capture_upsert_rollup(
  p_session_id   uuid,
  p_segment_id   text,
  p_scores       jsonb,
  p_item_medians jsonb,
  p_coverage     numeric,
  p_confidence   numeric,
  p_secret       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  perform assert_admin_secret(p_secret);

  insert into capture_segment_rollups (
    session_id, segment_id, score_overall, score_accessibility, score_drainage,
    score_shade, score_bike, item_medians, coverage, confidence
  )
  values (
    p_session_id, p_segment_id,
    (p_scores->>'overall')::numeric,
    (p_scores->>'accessibility')::numeric,
    (p_scores->>'drainage')::numeric,
    (p_scores->>'shade')::numeric,
    (p_scores->>'bike')::numeric,
    coalesce(p_item_medians, '{}'::jsonb),
    p_coverage, p_confidence
  )
  on conflict (session_id, segment_id) do update
    set score_overall       = excluded.score_overall,
        score_accessibility = excluded.score_accessibility,
        score_drainage      = excluded.score_drainage,
        score_shade         = excluded.score_shade,
        score_bike          = excluded.score_bike,
        item_medians        = excluded.item_medians,
        coverage            = excluded.coverage,
        confidence          = excluded.confidence,
        created_at          = now();
end;
$$;