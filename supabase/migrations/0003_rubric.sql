-- 0003_rubric.sql
-- The audit rubric is data, not code: methodology versions are permanent so old
-- audits stay interpretable. Items carry bilingual labels and map to a score
-- layer (overall/accessibility/drainage/shade).

create table if not exists rubric_versions (
  id        text primary key,
  label     text not null,
  frozen_at timestamptz,
  is_active boolean not null default false
);

create table if not exists rubric_items (
  id            text primary key,
  version_id    text not null references rubric_versions (id) on delete cascade,
  key           text not null,
  label_en      text not null,
  label_es      text not null,
  layer         text not null check (layer in ('overall', 'accessibility', 'drainage', 'shade')),
  ordering      integer not null,
  response_type text not null check (response_type in ('scale_0_4', 'boolean', 'percent')),
  unique (version_id, key)
);

create index if not exists rubric_items_version_ix on rubric_items (version_id, ordering);
