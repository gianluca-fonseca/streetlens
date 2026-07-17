-- 0009_views_district_audited_at.sql
-- Contract fixup (advisor rev 4): the frozen SegmentProperties shape guarantees
-- `district: string` and `audited_at: string` on every feature. Rebuild
-- v_segment_scores so the live path surfaces both: district is the human name
-- from the districts table; audited_at is the segment's latest audit date.

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
  coalesce(round(max(ls.score) filter (where ls.layer = 'shade'))::int, 0)         as score_shade
from segments s
join districts d on d.id = s.district_id
left join latest_audit la on la.segment_id = s.id
left join layer_scores ls on ls.segment_id = s.id
group by s.id, s.name, d.name, s.highway, s.length_m, s.demo, la.audited_on, s.geom;
