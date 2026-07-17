-- 0014_submission_types.sql
-- Widen the submissions type vocabulary for the CV capture funnel.
--
-- Two new values, for two different reasons:
--
--   cv_capture — a finished capture session entering the same review queue the
--                manual contributions use. Payload is {"session_id": "<uuid>"};
--                the capture data itself lives in the capture_* tables (0013)
--                and is NOT copied into the payload.
--
--   unknown    — the honest landing place for a submission whose type we do not
--                recognize. The honeypot path used to coerce any unrecognized
--                type to 'add_segment', which quietly mislabelled the rejected
--                row (see app/api/submissions/route.ts). Preserving the real
--                type is the fix, but a bot can post type:"<anything>", and
--                persisting that verbatim would violate this very CHECK and
--                turn a clean 400 into a 500. 'unknown' is where those land,
--                with the raw string kept in the payload for forensics.
--
-- The two existing types are untouched, so the manual contribution flow behaves
-- exactly as before.
--
-- Column-level `check (type in (...))` in 0005 is named submissions_type_check
-- by Postgres. Dropping and recreating it is the only way to widen it; this
-- migration touches NOTHING it did not create (the database is shared).

alter table submissions drop constraint if exists submissions_type_check;

alter table submissions add constraint submissions_type_check
  check (type in ('add_segment', 'update_segment', 'cv_capture', 'unknown'));
