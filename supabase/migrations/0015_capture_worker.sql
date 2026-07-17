-- 0015_capture_worker.sql
-- The read/write RPCs the ingest + extraction worker needs, which 0013 did not
-- ship. Purely ADDITIVE: every object is new and `capture_`-prefixed, nothing
-- 0013 created is altered or dropped, and the shared database is untouched
-- outside that prefix.
--
-- WHY THIS EXISTS. 0013 puts every capture_* table under RLS with ZERO policies
-- and routes all access through SECURITY DEFINER functions. That posture is
-- right, but the function set it shipped is incomplete for the worker:
--
--   * capture_claim_jobs returns `setof capture_frame_jobs` — job rows only. A
--     claimed job carries a frame_id and nothing else, so the pump learns
--     neither the storage_path it must send to the model nor the session the
--     frame belongs to, and it cannot select them (RLS denies it).
--   * Nothing can write segment_id / near_junction / location back onto
--     capture_frames, so map matching had no way to persist its result.
--   * Nothing can read capture_frames or capture_observations back, so finalize
--     could not attribute frames and rollups had nothing to aggregate.
--
-- Each gap is a dead end, not an inconvenience: the unit cannot work without
-- these. They are added here rather than by editing 0013, because 0013 is
-- already applied to the live shared database and migrations are append-only.
--
-- GATING. Every function here is ADMIN_RPC_SECRET-gated against app_secrets
-- (the 0007 pattern, matching 0013's privileged set) rather than capability-
-- scoped by session uuid. These are server-side worker operations: they read
-- storage paths and write match results, and nothing in the browser calls them.
-- The public, uuid-scoped surface from 0013 is unchanged and still the only
-- thing a client touches.

/* ------------------------------------------------------------------ *
 * 1. Frame reads + match write-back
 * ------------------------------------------------------------------ */

-- Every registered frame for a session, in seq order.
--
-- Finalize needs (seq, t) to hand to lib/matching, and the pump needs
-- storage_path. Returns no contributor PII — the session's ip hash and contact
-- stay unreadable, exactly as in capture_session_status.
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
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  return query
  select f.id, f.seq, f.t, f.storage_path, f.segment_id, f.near_junction
    from capture_frames f
   where f.session_id = p_session_id
   order by f.seq;
end;
$$;

-- Persist the matcher's verdict for a batch of frames.
--
-- Takes [{seq, segmentId, nearJunction, lng, lat}]. `segmentId` null is a
-- first-class answer (the fix fell outside the gate) and is stored as null
-- rather than skipped — a frame we could not place must not silently keep a
-- stale match. lng/lat are optional: when absent, location is left null.
--
-- Geography, not geometry: 0013 chose geography for capture locations so
-- distances come out in metres. st_makepoint takes (lng, lat) — GeoJSON order,
-- which is also the order lib/matching speaks.
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
  v_expected text;
  v_count    integer;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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

/* ------------------------------------------------------------------ *
 * 2. The pump's claim
 * ------------------------------------------------------------------ */

-- Claim up to p_limit pending jobs AND everything needed to run them.
--
-- The 0013 capture_claim_jobs is left in place untouched; this is the variant
-- the pump actually uses, because a job row alone is not workable (see header).
--
-- Two guards beyond 0013's version:
--   * Only sessions in `extracting` are claimed. A session moved to
--     `cost_paused` by the budget breaker stops yielding work immediately —
--     that is what makes the breaker a real stop rather than a label.
--   * Only frames with a matched segment_id. An unattributed frame cannot reach
--     a rollup, so paying a model to look at it is pure waste. Those jobs are
--     closed out by capture_fail_unattributed_jobs instead.
--
-- FOR UPDATE SKIP LOCKED on capture_frame_jobs is what makes concurrent pumps
-- safe: two racing callers take disjoint sets instead of both billing the same
-- frame. The lock is taken on the job rows only; the joins are read-side.
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

-- Close out pending jobs whose frame never matched a segment.
--
-- Called once by finalize, after attribution. `failed` (not a delete) so the
-- count stays honest: the contributor's status view should show that we looked
-- at the frame and could not place it, rather than the frame quietly vanishing.
create or replace function capture_fail_unattributed_jobs(
  p_session_id uuid,
  p_secret     text
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

/* ------------------------------------------------------------------ *
 * 3. Budget + drain accounting
 * ------------------------------------------------------------------ */

-- Cumulative model spend for one session, as recorded on its observations.
--
-- The per-session hard cap is enforced against this. It is derived from the
-- observation rows rather than kept as a counter on the session, so it cannot
-- drift out of sync with what was actually billed.
create or replace function capture_session_token_usage(
  p_session_id uuid,
  p_secret     text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_result   json;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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

-- Sessions in `extracting` with no pending or running jobs left: the queue has
-- drained and they are ready to roll up. Bounded so a pump call cannot fan out
-- unboundedly on a backlog.
create or replace function capture_drained_sessions(
  p_limit  integer,
  p_secret text
) returns setof uuid
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

-- Pending job count for a session — the pump's `remaining`, and how the status
-- route knows whether to keep polling.
create or replace function capture_pending_job_count(
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

  select count(*) into v_count
    from capture_frame_jobs j
    join capture_frames f   on f.id = j.frame_id
    join capture_sessions s on s.id = f.session_id
   where j.status = 'pending'
     and s.status = 'extracting';

  return coalesce(v_count, 0);
end;
$$;

/* ------------------------------------------------------------------ *
 * 4. Observation reads (for rollup)
 * ------------------------------------------------------------------ */

-- Every observation for a session, with the frame attribution it needs to be
-- aggregated. near_junction rides along from the frame because it is
-- ATTRIBUTION, never something the model asserted (lib/capture/types.ts keeps it
-- off the observation shape on purpose).
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
  seq           integer
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
         o.escalated, f.near_junction, f.seq
    from capture_observations o
    join capture_frames f on f.id = o.frame_id
   where f.session_id = p_session_id
   order by f.seq;
end;
$$;

/* ------------------------------------------------------------------ *
 * 5. Grants
 *
 * Same posture as 0013 section 7: callable by anon, each function enforcing its
 * own secret gate internally. The role is never the thing being trusted.
 * ------------------------------------------------------------------ */

revoke all on function capture_list_frames(uuid, text) from public;
revoke all on function capture_attribute_frames(uuid, jsonb, text) from public;
revoke all on function capture_claim_jobs_with_frames(integer, text) from public;
revoke all on function capture_fail_unattributed_jobs(uuid, text) from public;
revoke all on function capture_session_token_usage(uuid, text) from public;
revoke all on function capture_drained_sessions(integer, text) from public;
revoke all on function capture_pending_job_count(text) from public;
revoke all on function capture_list_observations(uuid, text) from public;

grant execute on function capture_list_frames(uuid, text) to anon, authenticated;
grant execute on function capture_attribute_frames(uuid, jsonb, text) to anon, authenticated;
grant execute on function capture_claim_jobs_with_frames(integer, text) to anon, authenticated;
grant execute on function capture_fail_unattributed_jobs(uuid, text) to anon, authenticated;
grant execute on function capture_session_token_usage(uuid, text) to anon, authenticated;
grant execute on function capture_drained_sessions(integer, text) to anon, authenticated;
grant execute on function capture_pending_job_count(text) to anon, authenticated;
grant execute on function capture_list_observations(uuid, text) to anon, authenticated;
