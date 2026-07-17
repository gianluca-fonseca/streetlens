-- 0011_bike_layer.sql
-- Bike infrastructure becomes the fifth first-class score layer (contract v2,
-- advisor rev 1 u6). Two changes:
--   1. rubric_items.layer may now be 'bike' (the check constraint from 0003 only
--      allowed overall/accessibility/drainage/shade).
--   2. v_segment_scores exposes score_bike alongside the four existing layers,
--      averaging the 'bike' rubric items exactly like every other layer.
-- score_bike is high = good (protected/dedicated infra), matching the ramp.

-- 1. Widen the rubric layer domain to include 'bike'.
alter table rubric_items drop constraint if exists rubric_items_layer_check;
alter table rubric_items
  add constraint rubric_items_layer_check
  check (layer in ('overall', 'accessibility', 'drainage', 'shade', 'bike'));

-- 2. Rebuild the read model so the live path surfaces score_bike. Mirrors 0009
-- exactly, plus the score_bike aggregate. security_invoker=on preserved.
drop view if exists v_segment_scores;

create view v_segment_scores
with (security_invoker = on) as
with latest_audit as (
  select distinct on (a.segment_id)
    a.id as audit_id,
    a.segment_id,
    a.audited_on
  from audits a
  order by a.segment_id, a.audited_on desc, a.created_at desc
),
layer_scores as (
  select
    la.segment_id,
    ri.layer,
    avg(
      case ri.response_type
        when 'boolean'   then o.response * 100
        when 'percent'   then o.response
        when 'scale_0_4' then o.response / 4.0 * 100
        else o.response
      end
    ) as score
  from latest_audit la
  join observations o on o.audit_id = la.audit_id
  join rubric_items ri on ri.id = o.item_id
  group by la.segment_id, ri.layer
)
select
  s.id,
  s.name,
  d.name as district,
  s.highway,
  s.length_m,
  s.demo,
  coalesce(la.audited_on::text, '') as audited_at,
  st_asgeojson(s.geom)::json as geometry,
  coalesce(round(max(ls.score) filter (where ls.layer = 'overall'))::int, 0)       as score_overall,
  coalesce(round(max(ls.score) filter (where ls.layer = 'accessibility'))::int, 0) as score_accessibility,
  coalesce(round(max(ls.score) filter (where ls.layer = 'drainage'))::int, 0)      as score_drainage,
  coalesce(round(max(ls.score) filter (where ls.layer = 'shade'))::int, 0)         as score_shade,
  coalesce(round(max(ls.score) filter (where ls.layer = 'bike'))::int, 0)          as score_bike
from segments s
join districts d on d.id = s.district_id
left join latest_audit la on la.segment_id = s.id
left join layer_scores ls on ls.segment_id = s.id
group by s.id, s.name, d.name, s.highway, s.length_m, s.demo, la.audited_on, s.geom;
