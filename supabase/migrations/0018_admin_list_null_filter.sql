-- 0018_admin_list_null_filter.sql
-- admin_list_submissions: null filter means ALL statuses.
--
-- The app (lib/submissions.ts, since u30) calls this RPC with
-- p_status_filter = null and expects every record back: the reconciled read
-- needs all statuses to compute counts and effective status. The 0010
-- definition only understood 'pending' | 'approved' | 'rejected', and its
-- guard used `p_status_filter not in (...)`, which is NULL (not true) for a
-- null input, so a null slipped past the guard into `status = null` and the
-- function returned an empty set instead of raising. The queue then trusted
-- the empty "live" result and rendered an empty admin queue while real
-- pending rows sat in the table.
--
-- Same signature, so this is a straight replace; no grants change.

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
  v_expected text;
begin
  select value into v_expected from app_secrets where key = 'admin_rpc_secret';
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'unauthorized';
  end if;

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
