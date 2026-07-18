-- 0024_cv_observation_contact.sql (u-provenance — segment provenance display)
-- Give the ADMIN review workbench the "submitted by" fact (the contributor's
-- contact) so a reviewer sees who sent a walk, alongside when it was walked and
-- when it was last updated (captured_on / created_at, already present).
--
-- PRIVACY RULE (conductor correction, non-negotiable). The contributor contact is
-- PII, often an email, collected without publish consent. It is NEVER surfaced on
-- the public map: no public read, RPC, or feature property carries it, and the
-- public popover attributes an observation to a generic "Community contributor".
-- Contact is admin-only, and reaches the workbench through exactly ONE channel:
-- the SECRET-gated capture_session_review_detail RPC extended below.
--
-- Why this RPC and not capture_session_review: that one is anon-callable (0017) —
-- knowing a session's uuid is its only capability, so anyone holding a session
-- link can call it, and it deliberately withholds contact/ip hash (0013/0017).
-- The detail RPC is secret-gated (only an authenticated admin has ADMIN_RPC_SECRET),
-- so surfacing contact HERE keeps the public/PII boundary intact. Additive and
-- backward-compatible: identical to 0021 except `contact` joins the return object.

begin;

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

commit;
