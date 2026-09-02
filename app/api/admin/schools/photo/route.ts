import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  deleteSchoolPhoto,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  saveSchoolPhoto,
  saveSchoolProfile,
} from "@/lib/school-store";
import { revalidatePublicMapPages } from "@/lib/revalidate-map";

export const runtime = "nodejs";

/**
 * POST /api/admin/schools/photo — attach a photo to a school (multipart).
 *
 * Separate from the JSON action route because a file upload is a different
 * content type and a different size budget, and folding it in would put a 6 MB
 * body limit on every profile edit.
 *
 * The stored filename is derived from the school id and the sniffed MIME type,
 * never from the upload's own name (see saveSchoolPhoto).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const id = form.get("id");
  const file = form.get("photo");
  if (typeof id !== "string" || !id || !(file instanceof File)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!PHOTO_TYPES[file.type]) {
    return NextResponse.json(
      { error: "unsupported_type", accepted: Object.keys(PHOTO_TYPES) },
      { status: 415 },
    );
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "too_large", max: PHOTO_MAX_BYTES }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const photo = await saveSchoolPhoto(id, bytes, file.type);
  await saveSchoolProfile(id, { photo });
  revalidatePublicMapPages();
  return NextResponse.json({ ok: true, photo });
}

/** DELETE /api/admin/schools/photo?id=… — remove it and forget it. */
export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await deleteSchoolPhoto(id);
  revalidatePublicMapPages();
  return NextResponse.json({ ok: true });
}
