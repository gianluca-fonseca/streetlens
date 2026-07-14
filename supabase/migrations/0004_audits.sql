-- 0004_audits.sql
-- audits (segment x date x auditor) -> observations (one per rubric item) ->
-- photos (per observation, stored by path in Supabase Storage). Re-audits are
-- first-class: the (segment, date, auditor) unique key allows temporal change.

create table if not exists audits (
  id                uuid primary key default gen_random_uuid(),
  segment_id        text not null references segments (id) on delete cascade,
  audited_on        date not null,
  auditor           text not null,
  rubric_version_id text not null references rubric_versions (id),
  demo              boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (segment_id, audited_on, auditor)
);

create index if not exists audits_segment_ix on audits (segment_id);

create table if not exists observations (
  id       uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits (id) on delete cascade,
  item_id  text not null references rubric_items (id),
  response numeric not null,
  note     text,
  unique (audit_id, item_id)
);

create index if not exists observations_audit_ix on observations (audit_id);

create table if not exists photos (
  id             uuid primary key default gen_random_uuid(),
  observation_id uuid not null references observations (id) on delete cascade,
  storage_path   text not null,
  taken_at       timestamptz not null default now()
);

create index if not exists photos_observation_ix on photos (observation_id);
