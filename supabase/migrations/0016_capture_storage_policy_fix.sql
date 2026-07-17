-- 0016_capture_storage_policy_fix.sql
-- The storage upload policy from 0013 can never pass. Nobody can upload a frame.
--
-- THE BUG. 0013 section 4 admits an anonymous INSERT into the bucket only when
-- the frame was registered first:
--
--   and exists (
--     select 1 from capture_frames f join capture_sessions s on s.id = f.session_id
--      where f.storage_path = storage.objects.name
--        and s.status in ('pending_upload', 'uploading')
--   )
--
-- That subquery is evaluated AS THE CALLING ROLE (anon), and RLS applies to
-- tables referenced inside a policy expression just as it does anywhere else.
-- 0013 section 3 puts capture_frames and capture_sessions under RLS with ZERO
-- policies. So for anon the subquery matches nothing, ever, no matter what was
-- registered — the policy's own security model is what blocks it.
--
-- The two halves of 0013 are each right and are mutually exclusive: "deny anon
-- all table access" and "let anon's upload be checked against those tables"
-- cannot both hold in a policy that runs as anon.
--
-- OBSERVED, against the live database (evidence:
-- .planning/evidence/u29/live-session-lifecycle.txt):
--   POST /api/capture/sessions/<id>/frames -> 200 {"accepted":[0,1,2]}
--   PUT  captures/<id>/frame-0000.jpg      -> 403 "new row violates row-level
--                                                  security policy"
-- with the session in `uploading`, the rows registered at exactly those paths,
-- and the path regex matching. Every other clause of the policy is satisfied.
--
-- THE FIX. Move the lookup into a SECURITY DEFINER function, which runs as owner
-- and therefore sees the rows, and have the policy call that. This is the
-- standard resolution for an RLS policy that must consult an RLS-protected
-- table, and it keeps 0013's posture exactly: the check still happens in the
-- database, registration is still what authorizes the upload, and anon still
-- cannot read capture_frames.
--
-- The function is deliberately NARROW. It takes a path and answers one boolean.
-- It cannot enumerate, it returns no data, and it tells a caller nothing they
-- did not already know (they hold the uuid and the path). Making it broader
-- would hand back the read access 0013 removed on purpose.
--
-- Additive: 0016 creates its own function and replaces only the policy 0013
-- created by name. Nothing else is touched, and the shared database is untouched
-- outside the capture_ prefix.

/* ------------------------------------------------------------------ *
 * 1. The definer check
 * ------------------------------------------------------------------ */

-- Is this exact storage path registered on a session that still takes uploads?
--
-- STABLE, not VOLATILE: it is a pure read, and storage evaluates it per row.
-- SET search_path is mandatory on a definer function — without it a caller could
-- shadow capture_frames with their own table and answer their own question.
create or replace function capture_frame_upload_allowed(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from capture_frames f
      join capture_sessions s on s.id = f.session_id
     where f.storage_path = p_name
       and s.status in ('pending_upload', 'uploading')
  );
$$;

revoke all on function capture_frame_upload_allowed(text) from public;
grant execute on function capture_frame_upload_allowed(text) to anon, authenticated;

/* ------------------------------------------------------------------ *
 * 2. The policy, rebuilt on it
 *
 * Same three clauses as 0013, same order, same intent — only the subquery moves
 * behind the definer. The bucket_id and regex checks stay inline: they are pure
 * string tests on the incoming row and need no table access, and keeping them
 * here means the cheap checks still short-circuit before the lookup.
 * ------------------------------------------------------------------ */

drop policy if exists capture_frames_anon_insert on storage.objects;
create policy capture_frames_anon_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'streetlens-frames'
    -- Belt and braces: the path convention is re-checked here even though the
    -- register RPC already derived it.
    and name ~ '^captures/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/frame-[0-9]{4}\.jpg$'
    -- Was it registered? Asked via a definer, because anon cannot read the
    -- tables that hold the answer. This is the line 0016 exists to change.
    and capture_frame_upload_allowed(name)
  );

-- Still deliberately NO update/delete policies: frames are write-once, and
-- storage keeps enforcing the bucket's own 2 MB / image-jpeg limits on top.
