-- 0007_admin_rpcs.sql
-- Admin review without a service-role key.
--
-- This deployment has no service-role key on the server. Instead, admin actions
-- go through SECURITY DEFINER functions that authenticate a shared secret
-- (ADMIN_RPC_SECRET) against a private `app_secrets` table. The functions run as
-- their owner and therefore bypass RLS on submissions/app_secrets; callers hold
-- only the anon key plus the secret.
--
-- Seed the secret AFTER migrating (see supabase/README.md):
--   insert into app_secrets (key, value) values ('admin_rpc_secret', '<ADMIN_RPC_SECRET>');

create table if not exists app_secrets (
  key   text primary key,
  value text not null
);

-- RLS on with zero policies => no anon/authenticated access at all. Only the
-- SECURITY DEFINER functions below (running as owner) can read it.
alter table app_secrets enable row level security;

-- Approve or reject a pending submission. Returns the updated row.
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
  v_expected text;
  v_row      submissions;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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

-- Aggregate counts for the admin dashboard.
create or replace function admin_stats(p_secret text)
returns json
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
    'segments',              (select count(*) from segments),
    'audits',                (select count(*) from audits),
    'submissions_pending',   (select count(*) from submissions where status = 'pending'),
    'submissions_approved',  (select count(*) from submissions where status = 'approved'),
    'submissions_rejected',  (select count(*) from submissions where status = 'rejected')
  ) into v_result;

  return v_result;
end;
$$;

-- Callable by the anon/authenticated roles, but each function enforces the
-- secret internally; the secret, not the role, is the gate.
revoke all on function admin_review_submission(uuid, text, text, text) from public;
revoke all on function admin_stats(text) from public;
grant execute on function admin_review_submission(uuid, text, text, text) to anon, authenticated;
grant execute on function admin_stats(text) to anon, authenticated;
