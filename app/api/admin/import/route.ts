import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSegments } from "@/lib/segments";
import { applyImportFeatures } from "@/lib/apply-submissions";
import type { ImportFeature } from "@/lib/schemas";
import {
  evaluateFeatures,
  parseFile,
  summarize,
} from "@/lib/import-pipeline";

// Uses fs (segments read + community store) + Web Crypto (session): Node runtime.
export const runtime = "nodejs";

/** Hard cap on a single import to bound work. */
const MAX_FEATURES = 2000;

/**
 * POST /api/admin/import — bulk import (advisor ruling 4).
 *
 *   { action: "validate", content, filename? }
 *     → dry-run: per-row validation preview, ZERO side effects.
 *   { action: "commit", content, filename?, verified, auditor? }
 *     → applies the valid, non-duplicate features through the single apply
 *       pipeline (lib/apply-submissions.ts).
 *
 * All validation is server-side (lib/import-pipeline). The session is
 * re-verified here independently of the proxy guard (proxy excludes /api).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: {
    action?: unknown;
    content?: unknown;
    filename?: unknown;
    verified?: unknown;
    auditor?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = body.action;
  if (action !== "validate" && action !== "commit") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const filename = typeof body.filename === "string" ? body.filename : undefined;

  const raw = parseFile(body.content, filename);
  if (!raw || raw.length === 0) {
    return NextResponse.json({ error: "parse" }, { status: 400 });
  }
  if (raw.length > MAX_FEATURES) {
    return NextResponse.json({ error: "too_many" }, { status: 413 });
  }

  const segments = await getSegments();
  const existingIds = new Set(segments.features.map((f) => f.properties.id));
  const evaluated = evaluateFeatures(raw, existingIds);
  const rows = evaluated.map((e) => e.row);
  const summary = summarize(rows);

  if (action === "validate") {
    return NextResponse.json({ rows, summary });
  }

  // Commit: apply the valid, non-duplicate features through the apply pipeline.
  const verified = body.verified === true;
  const auditor =
    verified && typeof body.auditor === "string" && body.auditor.trim()
      ? body.auditor.trim()
      : null;
  if (verified && !auditor) {
    return NextResponse.json({ error: "auditor_required" }, { status: 422 });
  }

  const features = evaluated
    .filter((e) => e.feature !== null)
    .map((e) => e.feature as ImportFeature);
  if (features.length === 0) {
    return NextResponse.json({ error: "no_valid" }, { status: 422 });
  }

  const result = await applyImportFeatures(features, { verified, auditor });
  return NextResponse.json({ imported: result.imported, ids: result.ids });
}
