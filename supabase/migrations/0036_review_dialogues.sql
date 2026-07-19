-- 0036_review_dialogues.sql
-- Reviewer ↔ model chat per segment in the capture review workbench.
--
-- The reviewer argues with the synthesis model in text (no vision): citing
-- frames as #N / #N-M, clarifying, then recomputing the segment assessment
-- EN+ES and lens scores with human corrections as ground truth. This migration
-- persists that chat so it survives refresh and remains an audit trail when
-- human_corrected=true.
--
-- LIVE DB IS SACRED — this file only; the conductor applies it.
--
--   capture_review_dialogues           — one row per chat message
--   capture_append_review_dialogue     — secret-gated write
--   capture_list_review_dialogues      — secret-gated read (sibling to
--                                        capture_session_review; workbench
--                                        loads it alongside the session)
--
-- Token spend for dialogue calls continues to fold into
-- capture_segment_rollups.synthesis_*_tokens via capture_set_segment_assessment
-- (no new ledger columns). Idempotent / re-runnable.

-- 1. Table ------------------------------------------------------------------

create table if not exists capture_review_dialogues (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references capture_sessions(id) on delete cascade,
  segment_id   text not null,
  role         text not null check (role in ('reviewer', 'assistant', 'system')),
  content      text not null,
  -- True on the assistant (or reviewer) message that triggered a recompute.
  recompute    boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists capture_review_dialogues_session_segment_created_idx
  on capture_review_dialogues (session_id, segment_id, created_at);

comment on table capture_review_dialogues is
  'Per-segment reviewer↔model chat for guided assessment correction (bgsd-0015).';
comment on column capture_review_dialogues.recompute is
  'True when this message triggered (or is the assistant reply from) a guided recompute.';

alter table capture_review_dialogues enable row level security;

-- 2. Append -----------------------------------------------------------------

create or replace function capture_append_review_dialogue(
  p_session_id uuid,
  p_segment_id text,
  p_role       text,
  p_content    text,
  p_recompute  boolean,
  p_secret     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_created timestamptz;
begin
  perform assert_admin_secret(p_secret);

  if p_segment_id is null or length(trim(p_segment_id)) = 0 then
    raise exception 'segment_id required';
  end if;
  if p_role is null or p_role not in ('reviewer', 'assistant', 'system') then
    raise exception 'invalid role';
  end if;
  if p_content is null or length(p_content) = 0 then
    raise exception 'content required';
  end if;
  if not exists (select 1 from capture_sessions where id = p_session_id) then
    raise exception 'session not found';
  end if;

  insert into capture_review_dialogues (session_id, segment_id, role, content, recompute)
  values (p_session_id, p_segment_id, p_role, p_content, coalesce(p_recompute, false))
  returning id, created_at into v_id, v_created;

  return jsonb_build_object(
    'id', v_id,
    'sessionId', p_session_id,
    'segmentId', p_segment_id,
    'role', p_role,
    'content', p_content,
    'recompute', coalesce(p_recompute, false),
    'createdAt', v_created
  );
end;
$$;

revoke all on function capture_append_review_dialogue(uuid, text, text, text, boolean, text) from public;
grant execute on function capture_append_review_dialogue(uuid, text, text, text, boolean, text) to anon, authenticated;

-- 3. List (sibling read for the workbench) ----------------------------------

create or replace function capture_list_review_dialogues(
  p_session_id uuid,
  p_secret     text,
  p_segment_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform assert_admin_secret(p_secret);

  if not exists (select 1 from capture_sessions where id = p_session_id) then
    raise exception 'session not found';
  end if;

  select coalesce(jsonb_agg(row order by row->>'createdAt', row->>'id'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'id', d.id,
        'sessionId', d.session_id,
        'segmentId', d.segment_id,
        'role', d.role,
        'content', d.content,
        'recompute', d.recompute,
        'createdAt', d.created_at
      ) as row
      from capture_review_dialogues d
      where d.session_id = p_session_id
        and (p_segment_id is null or d.segment_id = p_segment_id)
      order by d.created_at asc, d.id asc
    ) q;

  return v_result;
end;
$$;

revoke all on function capture_list_review_dialogues(uuid, text, text) from public;
grant execute on function capture_list_review_dialogues(uuid, text, text) to anon, authenticated;
