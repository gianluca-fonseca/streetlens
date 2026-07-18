/**
 * Browser-side capture upload client.
 *
 * Drives the whole funnel from the contributor's device:
 *
 *   createSession → registerFrames → PUT each frame to storage → finalize
 *
 * Design constraints that shaped this, all of them from the field rather than
 * the whiteboard: the contributor is outdoors, on mobile data, holding a phone
 * that may sleep, and has just spent twenty minutes walking a street. Losing
 * that to a flaky upload is the worst outcome in the product. So:
 *
 *   - Every network call retries with exponential backoff and jitter.
 *   - Uploads run bounded-concurrent (default 4) — enough to use the link,
 *     few enough not to melt a phone radio or trip the rate limiter.
 *   - The whole thing is RESUMABLE: re-registering is idempotent and returns
 *     every accepted seq, and a frame already in storage is treated as done
 *     rather than an error. Calling `uploadCapture` again after a failure
 *     picks up where it stopped instead of re-uploading 400 images.
 *
 * Browser-safe: fetch + supabase-js only, no node builtins.
 */

import { getSupabaseClient } from "@/lib/supabase";
import {
  CAPTURE_BUCKET,
  captureFrameStoragePath,
  type CaptureFrameMeta,
  type CaptureSessionMode,
  type CaptureSessionStatus,
  type TrackPoint,
  type TrackSource,
} from "./types";
import type {
  CreateSessionResponse,
  RegisterFramesResponse,
  SessionStatusResponse,
} from "./schemas";

/* ------------------------------------------------------------------ *
 * Public shapes
 * ------------------------------------------------------------------ */

/** One frame ready to upload: its metadata plus the JPEG bytes. */
export type PendingFrame = {
  meta: CaptureFrameMeta;
  blob: Blob;
};

export type UploadPhase =
  | "creating_session"
  | "registering_frames"
  | "uploading_frames"
  | "finalizing"
  | "done";

export type UploadProgress = {
  phase: UploadPhase;
  /** Frames uploaded so far (only meaningful during uploading_frames). */
  uploaded: number;
  total: number;
  sessionId: string | null;
};

export type UploadCaptureOptions = {
  mode: CaptureSessionMode;
  frames: PendingFrame[];
  track: TrackPoint[];
  source: TrackSource;
  contact?: string;
  clockOffsetMs?: number;
  /** Resume an existing session instead of opening a new one. */
  sessionId?: string;
  onProgress?: (progress: UploadProgress) => void;
  /** Concurrent frame uploads. Default 4. */
  concurrency?: number;
  /** Attempts per network call, including the first. Default 4. */
  maxRetries?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Injectable frame uploader. Defaults to `uploadFrameBytes` (direct to
   * storage). The seam exists because the bucket does not exist until 0013 is
   * applied, and the orchestration around it — retry, resume, ordering,
   * concurrency — is worth testing before then.
   */
  uploadFrame?: (
    sessionId: string,
    seq: number,
    blob: Blob,
  ) => Promise<"uploaded" | "already_present">;
  /** API origin. Defaults to same-origin (""). */
  baseUrl?: string;
  signal?: AbortSignal;
};

export type UploadCaptureResult = {
  sessionId: string;
  status: CaptureSessionStatus;
  uploadedSeqs: number[];
};

/** A failed call, carrying the HTTP status so callers can branch on it. */
export class CaptureUploadError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "CaptureUploadError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/* ------------------------------------------------------------------ *
 * Retry
 * ------------------------------------------------------------------ */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Retry with exponential backoff and jitter.
 *
 * Only retries what is worth retrying. A response we managed to classify is
 * NOT retried unless its status says so: a 400 means the request itself is
 * wrong, and a misconfigured client will be just as misconfigured four attempts
 * later. Hammering either one only costs a contributor battery and mobile data.
 *
 * An unclassified throw (fetch rejecting outright — offline, dead tunnel, DNS)
 * IS retried, because that is exactly the transient case this exists for.
 *
 * Jitter matters: every frame that failed inside one tunnel would otherwise
 * retry in lockstep and collide again on the far side.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof CaptureUploadError && !RETRYABLE_STATUS.has(err.status)) {
        throw err;
      }
      if (attempt === attempts - 1) break;
      const backoff = 300 * 2 ** attempt;
      await sleep(backoff + Math.random() * 200, signal);
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ *
 * API calls
 * ------------------------------------------------------------------ */

async function postJson<T>(
  url: string,
  body: unknown,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<T> {
  const response = await opts.fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) {
    throw new CaptureUploadError(
      `${url} responded ${response.status}`,
      response.status,
      url,
    );
  }
  return (await response.json()) as T;
}

async function getJson<T>(
  url: string,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<T> {
  const response = await opts.fetchImpl(url, { signal: opts.signal });
  if (!response.ok) {
    throw new CaptureUploadError(
      `${url} responded ${response.status}`,
      response.status,
      url,
    );
  }
  return (await response.json()) as T;
}

/**
 * The default fetch, bound to its receiver.
 *
 * `globalThis.fetch` on its own is NOT callable once detached from the global:
 * browsers require `this` to be the Window (or WorkerGlobalScope) and throw
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
 * otherwise. Node's undici does not care, which is why passing the bare
 * reference around survives every node test and then fails on the first real
 * upload from a phone.
 */
function defaultFetch(): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}

export async function createSession(
  opts: Pick<UploadCaptureOptions, "mode" | "contact" | "fetchImpl" | "baseUrl" | "signal" | "maxRetries">,
): Promise<CreateSessionResponse> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const url = `${opts.baseUrl ?? ""}/api/capture/sessions`;
  return withRetry(
    () =>
      postJson<CreateSessionResponse>(
        url,
        // honeypot is sent explicitly empty: the server distinguishes "empty"
        // from "absent", and a real client always has the field.
        { mode: opts.mode, honeypot: "", ...(opts.contact ? { contact: opts.contact } : {}) },
        { fetchImpl, signal: opts.signal },
      ),
    opts.maxRetries ?? 4,
    opts.signal,
  );
}

export async function registerFrames(
  sessionId: string,
  frames: CaptureFrameMeta[],
  opts: Pick<UploadCaptureOptions, "fetchImpl" | "baseUrl" | "signal" | "maxRetries">,
): Promise<RegisterFramesResponse> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const url = `${opts.baseUrl ?? ""}/api/capture/sessions/${sessionId}/frames`;
  return withRetry(
    () => postJson<RegisterFramesResponse>(url, { frames }, { fetchImpl, signal: opts.signal }),
    opts.maxRetries ?? 4,
    opts.signal,
  );
}

export async function getSessionStatus(
  sessionId: string,
  opts: Pick<UploadCaptureOptions, "fetchImpl" | "baseUrl" | "signal" | "maxRetries">,
): Promise<SessionStatusResponse> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const url = `${opts.baseUrl ?? ""}/api/capture/sessions/${sessionId}`;
  return withRetry(
    () => getJson<SessionStatusResponse>(url, { fetchImpl, signal: opts.signal }),
    opts.maxRetries ?? 4,
    opts.signal,
  );
}

export async function finalizeSession(
  sessionId: string,
  body: { track: TrackPoint[]; source: TrackSource; clockOffsetMs?: number },
  opts: Pick<UploadCaptureOptions, "fetchImpl" | "baseUrl" | "signal" | "maxRetries">,
): Promise<{ status: CaptureSessionStatus }> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const url = `${opts.baseUrl ?? ""}/api/capture/sessions/${sessionId}/finalize`;
  return withRetry(
    () => postJson<{ status: CaptureSessionStatus }>(url, body, { fetchImpl, signal: opts.signal }),
    opts.maxRetries ?? 4,
    opts.signal,
  );
}

/* ------------------------------------------------------------------ *
 * Storage upload
 * ------------------------------------------------------------------ */

/**
 * PUT one frame's bytes straight to storage, bypassing our API entirely.
 *
 * Direct-to-storage is the point: 400 images must never transit a serverless
 * function, which would be slower, pricier, and bounded by the body limit. The
 * `capture_frames` row registered earlier is what authorizes this write (see
 * the bucket policy in 0013) — the anon key alone cannot write anything.
 *
 * TODO(unit-capture-ingest): verify against the live bucket once 0013 is
 * applied. The bucket does not exist yet, so this path is UNVERIFIED — it is
 * the one part of this module the stub routes cannot exercise. Everything
 * around it (retry, resume, concurrency, ordering) is tested.
 *
 * Returns "uploaded", or "already_present" when storage reports a conflict —
 * which on resume is success, not failure.
 */
export async function uploadFrameBytes(
  sessionId: string,
  seq: number,
  blob: Blob,
): Promise<"uploaded" | "already_present"> {
  const client = getSupabaseClient();
  if (!client) {
    throw new CaptureUploadError(
      "Supabase is not configured; cannot upload frames",
      0,
      "storage",
    );
  }

  const path = captureFrameStoragePath(sessionId, seq);

  // Raw-body POST, deliberately NOT client.storage.upload(): supabase-js wraps
  // Blobs in multipart FormData with an unnamed part, and at least one mobile
  // WebKit serialization of that shape is rejected by the storage API with an
  // opaque 400 (observed live 2026-07-18: every phone frame upload 400'd while
  // raw-body uploads of the same bytes succeeded). A raw body with an explicit
  // Content-Type has no multipart parsing to disagree about.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) {
    throw new CaptureUploadError(
      "Supabase is not configured; cannot upload frames",
      0,
      "storage",
    );
  }

  const res = await fetch(
    `${base}/storage/v1/object/${CAPTURE_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "image/jpeg",
        // Never overwrite: frames are write-once, and a conflict is how resume
        // discovers this frame already landed.
        "x-upsert": "false",
      },
      body: blob,
    },
  );

  if (res.ok) return "uploaded";

  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    message = body.message ?? body.error ?? message;
  } catch {
    /* body was not json; keep the status text */
  }
  if (res.status === 409 || /exists/i.test(message)) return "already_present";

  throw new CaptureUploadError(`frame ${seq}: ${message}`, res.status, "storage");
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

/** Run tasks with bounded concurrency, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}

/**
 * Upload a whole capture: session → frames → track.
 *
 * Safe to call again with the same `sessionId` after a failure. Registration is
 * idempotent, and a frame already in storage counts as done, so a resumed run
 * re-uploads only what is actually missing.
 */
export async function uploadCapture(
  opts: UploadCaptureOptions,
): Promise<UploadCaptureResult> {
  const {
    frames,
    track,
    source,
    onProgress,
    concurrency = 4,
    clockOffsetMs = 0,
    signal,
  } = opts;

  const report = (phase: UploadPhase, uploaded: number, sessionId: string | null) =>
    onProgress?.({ phase, uploaded, total: frames.length, sessionId });

  // 1. Session. Reuse the caller's id when resuming.
  report("creating_session", 0, opts.sessionId ?? null);
  const sessionId =
    opts.sessionId ?? (await createSession(opts)).sessionId;

  // 2. Register. Idempotent; `accepted` is the resume cursor.
  report("registering_frames", 0, sessionId);
  const { accepted } = await registerFrames(
    sessionId,
    // The server derives the path anyway, but sending the canonical one keeps
    // the client honest and lets the schema catch a mismatch early.
    frames.map((f) => ({ ...f.meta, storagePath: captureFrameStoragePath(sessionId, f.meta.seq) })),
    opts,
  );
  const acceptedSeqs = new Set(accepted);

  // 3. Bytes. Only frames the server acknowledged — uploading one it never
  // registered would be rejected by the bucket policy anyway.
  const toUpload = frames.filter((f) => acceptedSeqs.has(f.meta.seq));
  let uploaded = 0;
  report("uploading_frames", 0, sessionId);

  const uploadFrame = opts.uploadFrame ?? uploadFrameBytes;

  const uploadedSeqs = await mapWithConcurrency(toUpload, concurrency, async (frame) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await withRetry(
      () => uploadFrame(sessionId, frame.meta.seq, frame.blob),
      opts.maxRetries ?? 4,
      signal,
    );
    uploaded += 1;
    report("uploading_frames", uploaded, sessionId);
    return frame.meta.seq;
  });

  // 4. Finalize. Last, and only once every frame is safely in storage: this is
  // the one-way door that enqueues extraction.
  report("finalizing", uploaded, sessionId);
  const { status } = await finalizeSession(
    sessionId,
    { track, source, clockOffsetMs },
    opts,
  );

  report("done", uploaded, sessionId);
  return { sessionId, status, uploadedSeqs: uploadedSeqs.sort((a, b) => a - b) };
}
