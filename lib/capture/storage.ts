/**
 * Capture-frame URL access — private bucket with short-lived signed URLs.
 *
 * 0013 sealed the bucket as public-read (uuid-as-capability). 0028 flips it
 * private: unapproved frames are no longer fetchable from a WhatsApp status
 * link. Reads go through:
 *
 *   - SUPABASE_SERVICE_ROLE_KEY signed URLs for admin review + the extraction
 *     pump (in-flight / unapproved frames have no SELECT policy).
 *   - Anon createSignedUrl for paths that pass capture_frame_evidence_readable
 *     (published community_cv_observations.frame_refs only) — used by the
 *     public evidence strip route.
 *
 * Contributor upload still uses the register-then-INSERT path (0016); private
 * buckets do not block INSERT policies.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import { CAPTURE_BUCKET } from "./types";

/** Default TTL for signed frame URLs (seconds). Short enough to limit share-leak. */
export const FRAME_SIGNED_URL_TTL_SECONDS = 120;

/** Public evidence strip: a little longer so a lightbox open still resolves. */
export const EVIDENCE_SIGNED_URL_TTL_SECONDS = 300;

let serviceCached: SupabaseClient | null | undefined;

/** True when a service-role key is configured for privileged frame signing. */
export function isFrameSigningConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Memoized service-role client for minting signed URLs on private objects.
 * Returns null when unconfigured — callers must degrade (placeholder / skip).
 */
export function getServiceSupabaseClient(): SupabaseClient | null {
  if (serviceCached !== undefined) return serviceCached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    serviceCached = null;
    return serviceCached;
  }

  serviceCached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceCached;
}

/**
 * @deprecated Prefer {@link signedFrameUrl}. Kept for tests that assert the old
 * public path shape; throws the same config error when Supabase URL is absent.
 */
export function publicFrameUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  // Deliberately still the /object/public/ form so a stray call is obvious in
  // logs after 0028 — it will 400 against a private bucket.
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${CAPTURE_BUCKET}/${storagePath}`;
}

export type SignedFrameUrlOptions = {
  /** TTL in seconds. Defaults to {@link FRAME_SIGNED_URL_TTL_SECONDS}. */
  expiresIn?: number;
  /**
   * Prefer service-role signing (admin / pump). When false, uses the anon
   * client — only succeeds for evidence-readable (published) paths.
   */
  privileged?: boolean;
};

/**
 * Mint a short-lived signed URL for a capture frame storage path.
 *
 * Throws when Supabase is unconfigured or signing fails — the pump treats that
 * as a job failure; admin review degrades the filmstrip tile.
 */
export async function signedFrameUrl(
  storagePath: string,
  options: SignedFrameUrlOptions = {},
): Promise<string> {
  const expiresIn = options.expiresIn ?? FRAME_SIGNED_URL_TTL_SECONDS;
  const privileged = options.privileged !== false;

  const client = privileged ? getServiceSupabaseClient() : getSupabaseClient();
  if (!client) {
    throw new Error(
      privileged
        ? "SUPABASE_SERVICE_ROLE_KEY is not configured; cannot sign private frame URLs"
        : "Supabase is not configured; cannot sign frame URLs",
    );
  }

  const { data, error } = await client.storage
    .from(CAPTURE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(
      `signed frame URL failed for ${storagePath}: ${error?.message ?? "no url"}`,
    );
  }
  return data.signedUrl;
}

/**
 * Best-effort signed URL for admin surfaces: never throws. Returns null when
 * signing is unavailable so the filmstrip can show a placeholder.
 */
export async function trySignedFrameUrl(
  storagePath: string,
  options: SignedFrameUrlOptions = {},
): Promise<string | null> {
  try {
    return await signedFrameUrl(storagePath, options);
  } catch {
    return null;
  }
}
