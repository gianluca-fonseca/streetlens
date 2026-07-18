-- 0030_vehicle_capture.sql (conductor hotfix, owner decision 2026-07-18)
--
-- The owner drove a capture session and 0026's anti-spoof speed cap (15 m/s)
-- rejected it at finalize. Ruling, verbatim: "driving is okay ... it's the only
-- way to collect efficiently. just make it take it anyway."
--
-- Vehicle-speed capture is therefore a legitimate collection mode. The cap's
-- real security job — rejecting GPS-spoofed teleports — survives at a ceiling
-- no road vehicle plausibly sustains between 1 Hz fixes: 38 m/s (~137 km/h).
-- Everything else in validate_capture_track (CR bbox, accuracy filter, minimum
-- usable fixes, live-style floors) is unchanged from 0026.

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
    if p.pt ? 'accuracy'
       and nullif(p.pt->>'accuracy', '') is not null
       and (p.pt->>'accuracy')::double precision > 25 then
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

  -- Teleport ceiling only: 38 m/s (~137 km/h). Vehicle capture is allowed
  -- (owner decision, 0030); GPS spoofing at highway-implausible speeds is not.
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
        if v_speed > 38 then
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
