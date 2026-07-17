-- 0002_geography.sql
-- Administrative hierarchy and street segments.
-- cantons -> districts -> corridors -> segments. Segment ids are stable text
-- (e.g. 'esc-sa-0001') so re-imports and cross-references stay durable.

create table if not exists cantons (
  id   text primary key,
  name text not null
);

create table if not exists districts (
  id        text primary key,
  canton_id text not null references cantons (id) on delete cascade,
  name      text not null
);

create table if not exists corridors (
  id          text primary key,
  district_id text not null references districts (id) on delete cascade,
  name        text not null
);

create table if not exists segments (
  id          text primary key,
  corridor_id text references corridors (id) on delete set null,
  canton_id   text not null references cantons (id),
  district_id text not null references districts (id),
  name        text not null,
  highway     text not null,
  length_m    double precision not null check (length_m >= 0),
  geom        geometry (LineString, 4326) not null,
  demo        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists segments_geom_gix on segments using gist (geom);
create index if not exists segments_district_ix on segments (district_id);
create index if not exists segments_corridor_ix on segments (corridor_id);
