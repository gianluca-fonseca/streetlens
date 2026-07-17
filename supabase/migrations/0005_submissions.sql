-- 0005_submissions.sql
-- Anonymous contribution queue. Nothing here writes directly to segments or
-- audits; a submission is a proposal an admin reviews (see 0007 RPCs).
-- Review metadata (reviewed_at, reviewer_note) and anti-abuse fields
-- (source_ip_hash, honeypot_tripped) live alongside the payload.

create table if not exists submissions (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('add_segment', 'update_segment')),
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at      timestamptz,
  reviewer_note    text,
  source_ip_hash   text,
  honeypot_tripped boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists submissions_status_ix on submissions (status, created_at desc);
