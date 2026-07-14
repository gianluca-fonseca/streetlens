-- 0008_views.sql
-- Read model for the map. `v_segment_scores` collapses each segment's latest
-- audit into one row: geometry as GeoJSON plus a 0-100 score per layer,
-- computed by normalizing each rubric item response to 0-100 and averaging
-- within its layer. This is the shape `lib/segments.ts` consumes when a live
-- Supabase DB is configured; the static GeoJSON is the fallback.
--
-- security_invoker=on so the view honors the querying role's RLS (public read
-- of published data), rather than running with the view owner's privileges.

create or replace view v_segment_scores
with (security_invoker = on) as
with latest_audit as (
  select distinct on (a.segment_id)
    a.id as audit_id,
    a.segment_id
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
  s.highway,
  s.length_m,
  s.demo,
  st_asgeojson(s.geom)::json as geometry,
  coalesce(round(max(ls.score) filter (where ls.layer = 'overall'))::int, 0)       as score_overall,
  coalesce(round(max(ls.score) filter (where ls.layer = 'accessibility'))::int, 0) as score_accessibility,
  coalesce(round(max(ls.score) filter (where ls.layer = 'drainage'))::int, 0)      as score_drainage,
  coalesce(round(max(ls.score) filter (where ls.layer = 'shade'))::int, 0)         as score_shade
from segments s
left join layer_scores ls on ls.segment_id = s.id
group by s.id, s.name, s.highway, s.length_m, s.demo, s.geom;
