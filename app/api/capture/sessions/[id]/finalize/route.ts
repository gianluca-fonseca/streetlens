/**
 * POST /api/capture/sessions/[id]/finalize — close a session and hand it to the
 * matcher.
 *
 * One-way: a finalized session stops accepting frames and its track cannot be
 * rewritten (`capture_finalize_session`, 0013).
 *
 * ORDER MATTERS, AND NOT THE OBVIOUS ONE. Everything that can fail — validating
 * the track, reading the frames, matching — runs BEFORE the finalize RPC moves
 * the session out of `uploading`. The RPC is the point of no return: it refuses
 * to run on an already-finalized session, so a failure after it cannot be
 * retried by the client and would strand the capture in `matching` forever. Do
 * the fallible work first, commit second.
 *
 * `clockOffsetMs` is recorded, never applied to the fixes — the stored track
 * stays exactly what the device reported, and the correction is data
 * (lib/capture/types.ts).
 *
 * Matching goes through the `lib/matching` interface, never an implementation:
 * unit-hmm-map-matching swaps the matcher underneath this route with no change
 * here.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { finalizeRequestSchema } from "@/lib/capture/schemas";
import { validateTrack, interpolateAt } from "@/lib/capture/track";
import { getCaptureDb, type FrameAttributionWrite } from "@/lib/capture/db";
import { pumpOnce } from "@/lib/capture/pump";
import { attributeFrames, matchTrack } from "@/lib/matching";
import type { FrameTime } from "@/lib/matching";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = finalizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { track: rawTrack, source, clockOffsetMs } = parsed.data;

  // Track hygiene: drop fixes whose own error bar is wider than the matcher's
  // gate, then decide whether what remains is a real track. The fix-count and
  // duration floors apply to `live` only — a gpx/trace import may legitimately
  // be sparse (see lib/capture/track.ts).
  const validation = validateTrack(rawTrack, source);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_track", reason: validation.reason },
      { status: 400 },
    );
  }
  const track = validation.track;

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  /* ---- Fallible work, before the point of no return ---- */

  let frames: FrameTime[];
  let frameRows: { seq: number; t: number }[];
  try {
    const rows = await db.listFrames(id);
    frameRows = rows.map((r) => ({ seq: r.seq, t: Number(r.t) }));
    frames = frameRows.map((r) => ({ seq: r.seq, t: r.t }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    console.error("[capture] finalize: listing frames failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  // Match and attribute in memory. A matcher must never throw on a
  // plausible-but-bad track (lib/matching/types.ts), so a throw here is a bug in
  // the matcher, not bad input — surface it rather than finalizing anyway.
  let attributions: FrameAttributionWrite[];
  try {
    const match = matchTrack(track, { frames });
    const attributed = attributeFrames(match, frames);

    attributions = frameRows.map((frame) => {
      const result = attributed.get(frame.seq);
      // Every input frame gets an entry, including unplaced ones — dropping them
      // would make coverage look better than it is (lib/matching/types.ts).
      const position = interpolateAt(track, frame.t);
      return {
        seq: frame.seq,
        segmentId: result?.segmentId ?? null,
        nearJunction: result?.nearJunction ?? false,
        ...(position ? { lng: position.lng, lat: position.lat } : {}),
      };
    });
  } catch (err) {
    console.error("[capture] finalize: matching failed:", err);
    return NextResponse.json({ ok: false, error: "matching_failed" }, { status: 500 });
  }

  /* ---- Commit ---- */

  try {
    // Persists the track + clock offset, enqueues one job per frame, and moves
    // the session to `matching`. Refuses on an already-finalized session.
    await db.finalizeSession(id, track, clockOffsetMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (/already finalized/i.test(message)) {
      return NextResponse.json({ ok: false, error: "already_finalized" }, { status: 409 });
    }
    console.error("[capture] finalize failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  try {
    await db.attributeFrames(id, attributions);
    // Close out jobs for frames that never matched a segment: they cannot reach
    // a rollup, so paying a model to look at them is waste. Failed rather than
    // deleted, so the contributor's status view stays honest about them.
    await db.failUnattributedJobs(id);
    await db.setSessionStatus(id, "extracting");
  } catch (err) {
    // The session is finalized and its jobs exist, but attribution did not land.
    // It stays `matching` and claims nothing (0015 only claims from
    // `extracting`), so this stalls rather than mis-spending. Loud on purpose.
    console.error("[capture] finalize: attribution failed, session stalled in matching:", err);
    return NextResponse.json({ ok: false, error: "attribution_failed" }, { status: 500 });
  }

  // Kick the queue without making the contributor wait for a model round-trip.
  // after() runs post-response; on Vercel it is backed by waitUntil, so the
  // invocation stays alive for it. Failures are logged, never surfaced — the
  // finalize already succeeded, and the cron and the client's status polling
  // both pump again anyway.
  after(async () => {
    try {
      await pumpOnce();
    } catch (err) {
      console.error("[capture] post-finalize pump failed:", err);
    }
  });

  return NextResponse.json({ status: "extracting" }, { status: 200 });
}
