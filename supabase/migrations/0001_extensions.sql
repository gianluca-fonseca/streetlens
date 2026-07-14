-- 0001_extensions.sql
-- Spatial + UUID support. PostGIS backs all segment geometry; pgcrypto provides
-- gen_random_uuid() for audit/observation/photo/submission primary keys.

create extension if not exists postgis;
create extension if not exists pgcrypto;
