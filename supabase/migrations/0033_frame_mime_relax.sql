-- 0033_frame_mime_relax.sql (conductor hotfix, 2026-07-18)
-- Live-mode frames are checkpointed to OPFS on the phone and re-read at upload
-- time; OPFS files carry no MIME type, so supabase-js posts them as
-- application/octet-stream and the bucket's jpeg-only allowlist rejected every
-- frame with invalid_mime_type (observed live; reproduced both ways). The MIME
-- label is client-controlled and is not a security boundary. The real guards
-- stay: registration-gated insert policy, path regex, write-once (no
-- update/delete policies), and the 2 MiB size cap.

update storage.buckets
   set allowed_mime_types = null
 where id = 'streetlens-frames';

do $$
declare
  v_types text[];
begin
  select allowed_mime_types into v_types from storage.buckets where id = 'streetlens-frames';
  if v_types is not null then
    raise exception '0033: streetlens-frames mime allowlist should be null, found %', v_types;
  end if;
end $$;
