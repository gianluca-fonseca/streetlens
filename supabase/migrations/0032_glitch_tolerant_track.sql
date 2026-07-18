-- 0032_glitch_tolerant_track.sql (conductor hotfix, owner decision 2026-07-18)
-- A single in-car GPS glitch fix (teleported ~100m with confident accuracy)
-- read as an implausible inter-fix speed and killed a whole real submission.
-- The matcher downstream is glitch-tolerant by design (cuts sub-trajectories,
-- never bridges); the validator must not be the one paranoid holdout.
-- Owner ruling stands: capture speed is not a rejection reason. The speed loop
-- is removed. Kept: CR bbox (with bad-accuracy fixes SKIPPED, not fatal —
-- mirroring the route's filter semantics), >=2 usable fixes, live-style floor.

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
  p         record;
begin
  if jsonb_typeof(p_track) <> 'array' then
    raise exception 'invalid_track';
  end if;

  for p in
    select * from jsonb_array_elements(p_track) as x(pt)
    where not (x.pt ? 'accuracy'
               and nullif(x.pt->>'accuracy', '') is not null
               and (x.pt->>'accuracy')::double precision > 25)
  loop
    v_lat := (p.pt->>'lat')::double precision;
    v_lng := (p.pt->>'lng')::double precision;
    if v_lat is null or v_lng is null
       or v_lat < 8 or v_lat > 11.5
       or v_lng < -86 or v_lng > -82 then
      raise exception 'invalid_track';
    end if;
  end loop;

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

  if v_count >= 10 and v_span_ms < 30000 then
    raise exception 'invalid_track';
  end if;
end;
$$;
