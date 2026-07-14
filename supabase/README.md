# StreetLens — Supabase

Postgres + PostGIS schema, RLS, and admin RPCs for the StreetLens data layer.

> **Status:** the live database does not exist yet. The app runs entirely off
> the static data files in `data/` until these env vars are set:
> `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Nothing in the app
> blocks on the DB (`lib/supabase.ts` returns `null` when unconfigured, and
> `lib/segments.ts` falls back to the generated GeoJSON).

## Layout

```
supabase/
  migrations/
    0001_extensions.sql   PostGIS + pgcrypto
    0002_geography.sql    cantons -> districts -> corridors -> segments
    0003_rubric.sql       versioned bilingual rubric
    0004_audits.sql       audits -> observations -> photos
    0005_submissions.sql  anonymous contribution queue
    0006_rls.sql          row-level security
    0007_admin_rpcs.sql   app_secrets + admin RPCs (no service role)
    0008_views.sql        v_segment_scores read model for the map
    0009_views_district_audited_at.sql  view fixup: district + audited_at
    0010_admin_list_rpc.sql  admin_list_submissions (queue read path)
  seed.sql                rubric v0.1 + demo geography/segments/audits (generated)
```

## Applying (when the DB arrives)

With the Supabase CLI linked to a project:

```bash
supabase db push          # applies migrations in numeric order
psql "$DATABASE_URL" -f supabase/seed.sql
```

Then seed the admin secret (do NOT commit the real value):

```sql
insert into app_secrets (key, value)
values ('admin_rpc_secret', '<ADMIN_RPC_SECRET from .env.local>')
on conflict (key) do update set value = excluded.value;
```

## Security model: admin without a service-role key

This deployment intentionally has **no service-role key** on the server. Admin
review is done through two `SECURITY DEFINER` RPCs that authenticate a shared
secret against the private `app_secrets` table (which has RLS on and zero
policies, so it is unreadable except from inside the definer functions):

- `admin_review_submission(p_submission_id uuid, p_action text, p_reason text, p_secret text)`
  — approves/rejects a pending submission; returns the updated row.
- `admin_stats(p_secret text)` — returns aggregate counts as JSON.
- `admin_list_submissions(secret text, status_filter text default 'pending')`
  — lists the submissions queue (id, type, payload, status, created_at,
  reviewed_at, reviewer_note), filtered by status, newest first, max 200 rows.
  `source_ip_hash` and `honeypot_tripped` are deliberately not returned
  (data minimization; they are abuse-forensics fields, not review-UI fields).

All raise `unauthorized` unless the secret matches `app_secrets.admin_rpc_secret`.
The admin client holds only the anon key plus the secret; the **secret, not the
role, is the gate**.

### RLS summary

| Tables | anon/authenticated access |
| --- | --- |
| cantons, districts, corridors, segments, rubric_versions, rubric_items, audits, observations, photos | `SELECT` only (published open data) |
| submissions | `INSERT` only, forced to `status = 'pending'`; not readable |
| app_secrets | no access (definer functions only) |

### Upgrade path

When a proper service-role backend is introduced:

1. Move admin operations behind a server route using the service-role key
   (never expose it to the browser).
2. Replace the secret check in the RPCs with role/JWT checks, or drop the RPCs in
   favor of service-role writes.
3. Remove the `admin_rpc_secret` row from `app_secrets`.

Until then, the secret-based RPCs are the sanctioned admin path.
