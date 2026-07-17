/**
 * Public URLs for capture frames.
 *
 * The bucket is public-read by a sealed decision (0013 section 4): frame paths
 * contain an unguessable session uuid, so the uuid IS the capability and the
 * bucket cannot be enumerated. That is what lets the extraction model fetch a
 * frame by URL instead of us signing one per call, and it is why this file is
 * three lines rather than a signing dance.
 *
 * Sending a URL rather than base64 keeps the request body small — the image
 * never transits our function, so a 400-frame session does not move 800 MB
 * through a serverless invocation to reach the model.
 */

import { CAPTURE_BUCKET } from "./types";

/**
 * Absolute public URL for a frame's storage path.
 *
 * Throws when Supabase is unconfigured rather than returning a relative URL:
 * the model fetches this from outside our network, so a relative path would
 * fail at the provider with an error that reads like a model fault.
 */
export function publicFrameUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${CAPTURE_BUCKET}/${storagePath}`;
}
