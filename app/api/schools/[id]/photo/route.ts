import { NextResponse } from "next/server";
import { readSchoolPhoto, readSchoolProfileMap } from "@/lib/school-store";

export const runtime = "nodejs";

/**
 * GET /api/schools/[id]/photo — serve a school's uploaded photo.
 *
 * Public: a school photo is context on a public card, not a secret. The
 * filename is read from the PROFILE rather than from the request, so the URL
 * space is exactly the set of photos an admin actually attached and a crafted
 * id cannot reach into the media directory. readSchoolPhoto re-validates the
 * shape anyway, because one guard is a guard and two are a policy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const profile = (await readSchoolProfileMap()).get(id);
  const filename = profile?.photo?.filename;
  if (!filename) return new NextResponse(null, { status: 404 });

  const found = await readSchoolPhoto(filename);
  if (!found) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "content-type": found.mime,
      // Short public cache: the photo can be replaced from the admin at any
      // time, and a stale headshot on a partner's screen is worse than a fetch.
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
