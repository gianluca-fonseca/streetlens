/**
 * The 501 contract envelope shared by the /api/capture stubs.
 *
 * Every capture route exists NOW, documenting its request/response shape and
 * answering 501, so the client unit can be built against a real URL before the
 * ingest unit fills in the bodies. Those units replace the BODIES, never the
 * SHAPES — if a shape has to change, it changes here and in
 * `lib/capture/schemas.ts` together, and every dependent unit is told.
 *
 * Not a route file itself: Next treats only `route.ts` as a handler, so shared
 * helpers must live beside it under a different name.
 */

import { NextResponse } from "next/server";

export type CaptureContract = {
  /** e.g. "POST /api/capture/sessions" */
  endpoint: string;
  /** One line on what it will do once implemented. */
  summary: string;
  /** The request body shape, as documentation. */
  request?: Record<string, string>;
  /** The success response shape, as documentation. */
  response: Record<string, string>;
  /** The unit that will implement this. */
  implementedBy: string;
};

/**
 * A 501 that carries its own contract.
 *
 * 501 (not 404, not 200-with-empty-data) is the honest answer: the endpoint is
 * real and specified, and it is not built yet. A client that treats a 501 as
 * success would be a bug in the client, which is exactly what we want.
 */
export function notImplemented(contract: CaptureContract): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: "not_implemented",
      contract,
    },
    { status: 501 },
  );
}
