/**
 * Write-through frame storage.
 *
 * A walk is 20 minutes of a walker's life and up to 400 frames of a phone
 * holding JPEGs in a tab that iOS will happily discard the moment memory gets
 * tight. So nothing is held in memory waiting for an upload: every kept frame
 * and an updated manifest hit OPFS immediately. Crashing loses the frame in
 * flight, not the walk.
 *
 * `openCaptureStore()` always resolves to a working store. Where OPFS is not
 * usable it returns an in-memory one with `durable: false`, and the UI is
 * responsible for saying so out loud (the brief: degrade with a visible warning,
 * never crash). We would rather record a fragile walk than refuse to record.
 *
 * Support is detected by probing for `createWritable`, not by sniffing the
 * browser. Safari reached OPFS through `createSyncAccessHandle` in workers long
 * before it had `createWritable` on the main thread, so presence of
 * `navigator.storage.getDirectory` proves nothing about whether we can write
 * here. This is one of the things MANUAL-VERIFY.md flags for a real device.
 */

import type { PendingFrame } from "@/lib/capture/upload-client";
import { isSessionManifest, type SessionManifest } from "@/components/capture/engine/session";

const ROOT_DIR = "captures";
const MANIFEST_FILE = "manifest.json";

/** Mirrors `captureFrameStoragePath`'s leaf so on-disk names match the wire. */
function frameFileName(seq: number): string {
  return `frame-${String(seq).padStart(4, "0")}.jpg`;
}

export type CaptureStore = {
  /** False when frames live only in memory and will not survive a reload. */
  readonly durable: boolean;
  putFrame(localId: string, seq: number, blob: Blob): Promise<void>;
  putManifest(manifest: SessionManifest): Promise<void>;
  /** Every manifest currently on disk, newest first. */
  listManifests(): Promise<SessionManifest[]>;
  /** Re-hydrate a manifest's frames into upload-ready blobs. */
  loadFrames(manifest: SessionManifest): Promise<PendingFrame[]>;
  discard(localId: string): Promise<void>;
};

export function isOpfsSupported(): boolean {
  if (typeof navigator === "undefined" || typeof FileSystemFileHandle === "undefined") {
    return false;
  }
  return (
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle.prototype.createWritable === "function"
  );
}

/**
 * Serialises writes.
 *
 * OPFS write handles are exclusive: two overlapping `createWritable()` calls on
 * one file throw `NoModificationAllowedError`. Frames arrive from a video
 * callback while the manifest is rewritten after each one, so overlap is the
 * normal case, not the edge case. Everything funnels through one chain.
 */
function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    // Keep the chain alive after a rejection so one bad write cannot wedge the
    // queue. The caller still sees its own error via `run`.
    tail = run.catch(() => undefined);
    return run;
  };
}

class OpfsStore implements CaptureStore {
  readonly durable = true;
  private readonly enqueue = createWriteQueue();

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async sessionDir(localId: string, create: boolean) {
    const captures = await this.root.getDirectoryHandle(ROOT_DIR, { create });
    return captures.getDirectoryHandle(localId, { create });
  }

  private async write(localId: string, name: string, data: Blob | string) {
    const dir = await this.sessionDir(localId, true);
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      // NOT a `finally { close() }`. Once a write has errored the stream is
      // errored too, and closing it rejects with its own TypeError, which would
      // replace the pending exception and throw away the reason. That reason is
      // usually QuotaExceededError, i.e. exactly the one the recorder branches
      // on to stop the walk cleanly. Abort instead, and rethrow the original.
      try {
        await stream.abort();
      } catch {
        // Already errored or already closing. The original throw is what matters.
      }
      throw error;
    }
  }

  putFrame(localId: string, seq: number, blob: Blob): Promise<void> {
    return this.enqueue(() => this.write(localId, frameFileName(seq), blob));
  }

  putManifest(manifest: SessionManifest): Promise<void> {
    // Snapshot now, not inside the job: the manifest is mutated as more frames
    // land, and we must persist the state as of this call.
    const json = JSON.stringify(manifest);
    return this.enqueue(() => this.write(manifest.localId, MANIFEST_FILE, json));
  }

  async listManifests(): Promise<SessionManifest[]> {
    let captures: FileSystemDirectoryHandle;
    try {
      captures = await this.root.getDirectoryHandle(ROOT_DIR, { create: false });
    } catch {
      return []; // Nothing ever recorded on this device.
    }

    const found: SessionManifest[] = [];
    for await (const entry of captures.values()) {
      if (entry.kind !== "directory") continue;
      try {
        const dir = await captures.getDirectoryHandle(entry.name, { create: false });
        const handle = await dir.getFileHandle(MANIFEST_FILE, { create: false });
        const parsed: unknown = JSON.parse(await (await handle.getFile()).text());
        // A manifest from an older build, or a half-written one, is debris and
        // is skipped rather than crashing the page it is recovered onto.
        if (isSessionManifest(parsed)) found.push(parsed);
      } catch {
        continue;
      }
    }
    return found.sort((a, b) => b.startedAt - a.startedAt);
  }

  async loadFrames(manifest: SessionManifest): Promise<PendingFrame[]> {
    const dir = await this.sessionDir(manifest.localId, false);
    const frames: PendingFrame[] = [];
    for (const meta of manifest.frames) {
      try {
        const handle = await dir.getFileHandle(frameFileName(meta.seq), { create: false });
        const file = await handle.getFile();
        frames.push({ meta, blob: file });
      } catch {
        // Manifest references a frame whose bytes are gone. Upload what we have
        // rather than failing the whole recovery; the count shown to the user
        // comes from this array, so it stays truthful.
        continue;
      }
    }
    return frames;
  }

  /**
   * Queued like every other write. Deleting out of band would race a pending
   * `putManifest`, whose `create: true` would resurrect the directory with a
   * manifest listing frames whose bytes are gone. That resurrected walk would
   * then be offered back on the next visit and recover into nothing.
   */
  discard(localId: string): Promise<void> {
    return this.enqueue(async () => {
      const captures = await this.root.getDirectoryHandle(ROOT_DIR, { create: true });
      try {
        await captures.removeEntry(localId, { recursive: true });
      } catch {
        // Already gone is the desired end state.
      }
    });
  }
}

/** Fallback when OPFS cannot be written. Same surface, no durability. */
class MemoryStore implements CaptureStore {
  readonly durable = false;
  private readonly manifests = new Map<string, SessionManifest>();
  private readonly frames = new Map<string, Blob>();

  private key(localId: string, seq: number) {
    return `${localId}/${seq}`;
  }

  async putFrame(localId: string, seq: number, blob: Blob): Promise<void> {
    this.frames.set(this.key(localId, seq), blob);
  }

  async putManifest(manifest: SessionManifest): Promise<void> {
    this.manifests.set(manifest.localId, structuredClone(manifest));
  }

  /**
   * Always empty. Recovery means "survived a reload", and nothing in this store
   * does; claiming otherwise would offer the user a session we cannot produce.
   */
  async listManifests(): Promise<SessionManifest[]> {
    return [];
  }

  async loadFrames(manifest: SessionManifest): Promise<PendingFrame[]> {
    const out: PendingFrame[] = [];
    for (const meta of manifest.frames) {
      const blob = this.frames.get(this.key(manifest.localId, meta.seq));
      if (blob) out.push({ meta, blob });
    }
    return out;
  }

  async discard(localId: string): Promise<void> {
    this.manifests.delete(localId);
    for (const key of [...this.frames.keys()]) {
      if (key.startsWith(`${localId}/`)) this.frames.delete(key);
    }
  }
}

/** Never rejects: a store you can record into is always returned. */
export async function openCaptureStore(): Promise<CaptureStore> {
  if (!isOpfsSupported()) return new MemoryStore();
  try {
    return new OpfsStore(await navigator.storage.getDirectory());
  } catch {
    // Private browsing and locked-down storage policies both land here.
    return new MemoryStore();
  }
}

/** True when the error is the browser refusing more bytes. */
export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
