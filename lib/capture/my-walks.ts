/**
 * Device-local walk history — no account, no server sync.
 */

import type { CaptureSessionStatus } from "@/lib/capture/types";

export type MyWalkEntry = Readonly<{
  sessionId: string;
  submittedAt: string;
  mode: "live" | "video";
  frameCount: number;
  distanceM: number;
  elapsedMs: number;
  /** Last known pipeline status from the status page poll. */
  status?: CaptureSessionStatus;
  /** Street names from segment rollups, when known. */
  streetNames?: readonly string[];
}>;

const STORAGE_KEY = "streetlens-my-walks";
const MAX_ENTRIES = 20;

function readAll(): MyWalkEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is MyWalkEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as MyWalkEntry;
  return (
    typeof e.sessionId === "string" &&
    typeof e.submittedAt === "string" &&
    (e.mode === "live" || e.mode === "video") &&
    typeof e.frameCount === "number" &&
    typeof e.distanceM === "number" &&
    typeof e.elapsedMs === "number"
  );
}

function writeAll(entries: MyWalkEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new Event("streetlens-my-walks"));
  } catch {
    // Quota or private mode — non-fatal.
  }
}

/*
 * Snapshot cache — load-bearing, not an optimisation.
 *
 * `listMyWalks` is the `getSnapshot` of a `useSyncExternalStore`
 * (MyWalksShelf). React compares snapshots with `Object.is`, so returning a
 * freshly parsed-and-sorted array on every call means the store never
 * converges: React re-renders, re-reads, gets another new array, and blows the
 * update-depth limit. That threw "Maximum update depth exceeded" (React #185)
 * out of the client boundary and took the WHOLE /collect and
 * /collect/status/[id] tree down to Next's global error fallback, at every
 * viewport and in both locales, including on a first visit with empty storage
 * (`[] !== []`).
 *
 * So the identity has to be stable for as long as the underlying data is. The
 * raw string is the cache key: writes go through `writeAll`, which rewrites
 * that string, so any real change misses the cache and any repeat read hits it.
 */
let cachedRaw: string | null = null;
let cachedList: readonly MyWalkEntry[] = Object.freeze([]);

export function listMyWalks(): readonly MyWalkEntry[] {
  if (typeof window === "undefined") return cachedList;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode: nothing readable, and nothing that can change underneath us.
    return cachedList;
  }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  cachedList = Object.freeze(
    readAll().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
  );
  return cachedList;
}

export function addMyWalk(entry: MyWalkEntry): void {
  const existing = readAll().filter((e) => e.sessionId !== entry.sessionId);
  writeAll([entry, ...existing]);
}

export function updateMyWalk(
  sessionId: string,
  patch: Partial<Pick<MyWalkEntry, "status" | "streetNames">>,
): void {
  const entries = readAll();
  const index = entries.findIndex((e) => e.sessionId === sessionId);
  if (index < 0) return;
  const next = [...entries];
  next[index] = { ...next[index], ...patch };
  writeAll(next);
}
