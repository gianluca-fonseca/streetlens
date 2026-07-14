-- 0010_admin_list_rpc.sql
-- Admin read path for the submissions queue (u4-admin finding: submissions is
-- INSERT-only under RLS for anon, and no RPC listed it — the admin queue could
-- not read the DB). Same secret-gated SECURITY DEFINER pattern as 0007.
--
-- Data minimization: source_ip_hash (and honeypot_tripped) are intentionally
-- NOT returned; they exist for abuse forensics, not for the review UI.

create or replace function admin_list_submissions(
  secret        text,
  status_filter text default 'pending'
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
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or secret is null or secret <> v_expected then
    raise exception 'unauthorized';
  end if;

  if status_filter not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid status filter: %', status_filter;
  end if;

  return query
    select s.id, s.type, s.payload, s.status, s.created_at, s.reviewed_at, s.reviewer_note
    from submissions s
    where s.status = status_filter
    order by s.created_at desc
    limit 200;
end;
$$;

revoke all on function admin_list_submissions(text, text) from public;
grant execute on function admin_list_submissions(text, text) to anon, authenticated;
