/**
 * Env-gated Supabase client.
 *
 * The live database does not exist yet. Nothing in the app may block on it, so
 * this module hands back a client ONLY when both public env vars are present;
 * otherwise it returns `null` and callers fall back to the static data files
 * (see `lib/segments.ts`). When Supabase is provisioned, set
 * `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the same
 * code path lights up with no other change.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/** True when both public Supabase env vars are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Returns a memoized anon Supabase client, or `null` when unconfigured.
 * Callers must handle the `null` case by falling back to static data.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) {
    return cached;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cached = null;
    return cached;
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return cached;
}
