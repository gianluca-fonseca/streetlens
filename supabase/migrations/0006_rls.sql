-- 0006_rls.sql
-- Row-level security. StreetLens is open-data by design, so the published
-- reference tables (geography, rubric, audits, observations, photos) are
-- publicly readable. Writes are locked down: anonymous users may ONLY insert a
-- pending submission — never touch segments/audits directly. Everything else is
-- deny-by-default (RLS on, no permissive policy).

-- Published, publicly-readable reference data.
alter table cantons          enable row level security;
alter table districts        enable row level security;
alter table corridors        enable row level security;
alter table segments         enable row level security;
alter table rubric_versions  enable row level security;
alter table rubric_items     enable row level security;
alter table audits           enable row level security;
alter table observations     enable row level security;
alter table photos           enable row level security;

create policy cantons_public_read         on cantons         for select to anon, authenticated using (true);
create policy districts_public_read       on districts       for select to anon, authenticated using (true);
create policy corridors_public_read       on corridors       for select to anon, authenticated using (true);
create policy segments_public_read        on segments        for select to anon, authenticated using (true);
create policy rubric_versions_public_read on rubric_versions for select to anon, authenticated using (true);
create policy rubric_items_public_read    on rubric_items    for select to anon, authenticated using (true);
create policy audits_public_read          on audits          for select to anon, authenticated using (true);
create policy observations_public_read    on observations    for select to anon, authenticated using (true);
create policy photos_public_read          on photos          for select to anon, authenticated using (true);

-- Submissions: anonymous INSERT only, always as a fresh pending proposal.
-- No SELECT/UPDATE/DELETE policy exists, so the queue (with its ip hashes and
-- review notes) is invisible to the public; admins read/act via the RPCs in
-- 0007 (SECURITY DEFINER, which bypasses RLS).
alter table submissions enable row level security;

create policy submissions_anon_insert on submissions
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_at is null
    and reviewer_note is null
  );
