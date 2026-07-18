-- 0031_testing_rate_relief.sql (conductor hotfix, owner decision 2026-07-18)
-- Capture-session ceiling raised 3 -> 30/hour per IP hash for the field-testing
-- era ("remove the too many uploads thing for now"). The bound stays so a
-- hostile IP cannot open unbounded model spend. Everything else in
-- capture_create_session (secret gate, mode check, null-ip rejection) is
-- unchanged from 0026. Route-side mirror: lib/rate-limit.ts capture capacity.

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

  if p_ip_hash is null or btrim(p_ip_hash) = '' then
    raise exception 'rate_limited';
  end if;

  select count(*) into v_recent
    from capture_sessions
   where source_ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'rate_limited';
  end if;

  insert into capture_sessions (mode, source_ip_hash, contact)
  values (p_mode, p_ip_hash, nullif(btrim(p_contact), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function capture_create_session(text, text, text, text) from public;
grant execute on function capture_create_session(text, text, text, text) to anon, authenticated;
