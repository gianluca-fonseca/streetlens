"use client";

/**
 * The contributor's live view of one walk.
 *
 * WHAT AUTHORIZES IT: the session uuid in the url, and nothing else. This talks
 * only to GET /api/capture/sessions/[id], which deliberately withholds the ip
 * hash, the contact and the token spend. Nothing here may render a field that
 * route does not return: the temptation is to "just show the cost", and the cost
 * is admin-only on purpose.
 *
 * WHY IT PUMPS. The extraction cron runs once a day, so on a Hobby plan a walk
 * whose finalize did not drain sits untouched for hours. While somebody is
 * actually watching this page we POST the per-session pump, which is scoped and
 * rate limited to their own walk (see the route's header). That is the whole
 * reason this page moves at all. It pumps ONLY while the status is `extracting`:
 * a `cost_paused` walk is a human's decision to make, and a poll must never
 * resurrect it.
 *
 * WHY THE POLL, NOT THE PUMP, IS THE SOURCE OF TRUTH. The pump answers with a
 * status too, and using it would give the page two writers racing on one state.
 * The pump's reply is discarded; the next poll reports what happened. It also
 * means a pump that fails is invisible here, which is correct: a failed pump
 * costs the contributor nothing but time, and the cron is still behind it.
 */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Eyebrow, LiveDot, Notice, Plate } from "@/components/capture/ui";
import { cn } from "@/components/ui/cn";
import type { CaptureSessionStatus } from "@/lib/capture/types";

/**
 * The GET's response, restated rather than imported: `SessionStatusPayload`
 * lives in `lib/capture/db`, which reaches for the service key on import and has
 * no business in a browser bundle. This is the wire contract, and it is the
 * route's job to keep matching it.
 */
type Rollup = Readonly<{
  segmentId: string;
  coverage: number;
  confidence: number;
  scores: Record<string, number>;
}>;

type Snapshot = Readonly<{
  status: CaptureSessionStatus;
  frameCount: number;
  jobs: Readonly<{ pending: number; done: number; failed: number }>;
  /** Present only once there is at least one rollup. Absent is not empty. */
  rollups?: readonly Rollup[];
}>;

type StatusError = "not_found" | "invalid_session" | "unavailable" | "server_error" | "network";

/** Fast enough to feel live, slow enough that a held-open tab is not a load test. */
const POLL_MS = 4_000;
/** Matches the pump's own budget: capacity 6 per 60s, keyed by session. */
const PUMP_MS = 20_000;
/** What we wait when the pump refuses without saying for how long. */
const PUMP_BACKOFF_MS = 60_000;

/** Nothing polls its way out of these, so the timer stops. */
const TERMINAL: readonly CaptureSessionStatus[] = ["review_ready", "approved", "rejected", "failed"];

const STEPS = ["received", "matched", "read", "review", "decided"] as const;

/**
 * How far the lifecycle has got, as an index into STEPS.
 *
 * `failed` returns -1 on purpose. A walk can fail at matching or at extraction
 * and the status alone does not say which, so claiming a step reached would be
 * inventing detail. The failure notice carries it instead.
 */
function reachedStep(status: CaptureSessionStatus): number {
  switch (status) {
    case "pending_upload":
    case "uploading":
      return 0;
    case "matching":
      return 1;
    case "extracting":
    case "cost_paused":
      return 2;
    case "review_ready":
      return 3;
    case "approved":
    case "rejected":
      return 4;
    case "failed":
      return -1;
  }
}

/**
 * An error the walker can act on (or at least understand), announced.
 *
 * Not `Notice`: that renders `role="status"`, and a status page that has just
 * lost its backend should interrupt rather than queue politely. The left-rule
 * tone vocabulary is `Notice`'s, deliberately, so the two read as one family.
 */
function Alert({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div
      role="alert"
      className="rounded-[4px] border border-l-[3px] border-border border-l-accent bg-surface-elevated p-3"
    >
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-neutral-strong">{body}</p>
    </div>
  );
}

export function StatusClient({ sessionId }: Readonly<{ sessionId: string }>) {
  const t = useTranslations("collect");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<StatusError | null>(null);

  useEffect(() => {
    // Loop state is per-effect and closed over, not refs: there is exactly one
    // loop per mounted session and `cancelled` retires it. A ref would outlive
    // the id it belongs to.
    let cancelled = false;
    let timer: number | undefined;
    let lastPumpAt = 0;
    let pumpNotBefore = 0;
    let pumping = false;

    const pump = async () => {
      pumping = true;
      try {
        const res = await fetch(`/api/capture/sessions/${sessionId}/pump`, { method: "POST" });
        if (res.status === 429) {
          // Believe the server's own number. Retrying sooner than it asked is
          // how a polite client becomes the reason the limit exists.
          const retryAfter = Number(res.headers.get("retry-after"));
          pumpNotBefore =
            Date.now() +
            (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : PUMP_BACKOFF_MS);
        } else if (!res.ok) {
          pumpNotBefore = Date.now() + PUMP_BACKOFF_MS;
        }
      } catch {
        // Offline, or the pump timed out holding a batch. Either way the poll
        // still reports the truth, so back off quietly and let it.
        pumpNotBefore = Date.now() + PUMP_BACKOFF_MS;
      } finally {
        pumping = false;
        lastPumpAt = Date.now();
      }
    };

    const tick = async () => {
      let snap: Snapshot | null = null;

      try {
        const res = await fetch(`/api/capture/sessions/${sessionId}`, { cache: "no-store" });
        if (cancelled) return;

        if (res.ok) {
          snap = (await res.json()) as Snapshot;
          if (cancelled) return;
          setSnapshot(snap);
          setError(null);
        } else {
          const failure: StatusError =
            res.status === 404
              ? "not_found"
              : res.status === 400
                ? "invalid_session"
                : res.status === 503
                  ? "unavailable"
                  : "server_error";
          setError(failure);
          // Permanent answers. This id will not become a walk by being asked
          // again, so the timer stops here rather than polling a 404 forever.
          if (failure === "not_found" || failure === "invalid_session") return;
        }
      } catch {
        if (cancelled) return;
        setError("network");
      }

      // Terminal: the only thing another poll could change is the bill.
      if (snap && TERMINAL.includes(snap.status)) return;

      const now = Date.now();
      if (
        snap?.status === "extracting" &&
        !pumping &&
        now - lastPumpAt >= PUMP_MS &&
        now >= pumpNotBefore
      ) {
        // Not awaited: a pump batch can hold for tens of seconds, and the poll
        // has to keep telling the truth while it does.
        void pump();
      }

      timer = window.setTimeout(tick, POLL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sessionId]);

  // A walk that is not there, or a link that was never one. There is no progress
  // to render behind this, so it is the whole view.
  if (error === "not_found" || error === "invalid_session") {
    return <Alert title={t(`status.errors.${error}.title`)} body={t(`status.errors.${error}.body`)} />;
  }

  const status = snapshot?.status;
  const reached = status === undefined ? -1 : reachedStep(status);
  const settled = status === "approved" || status === "rejected";
  // `cost_paused` sits on the extraction step without advancing it, so the dot
  // must not pulse: a live dot over stalled work is a lie told in pink.
  const advancing = status !== undefined && !settled && status !== "cost_paused" && reached >= 0;
  const rollups = snapshot?.rollups ?? [];

  return (
    <div className="flex flex-col gap-6">
      {error !== null ? (
        <Alert title={t(`status.errors.${error}.title`)} body={t(`status.errors.${error}.body`)} />
      ) : null}

      <section role="status" aria-live="polite" className="flex flex-col gap-4">
        {status === undefined ? (
          <p className="text-[14px] text-ink-muted">{t("status.loading")}</p>
        ) : (
          <>
            <p className="font-serif text-[15px] leading-[1.6] text-neutral-strong">
              {t(`status.state.${status}`)}
            </p>

            <Plate className="flex flex-col gap-3 p-4">
              <ol className="flex flex-col gap-2">
                {STEPS.map((step, index) => {
                  const done = index < reached || (index === reached && settled);
                  const current = index === reached && !settled;
                  return (
                    <li key={step} className="flex items-center gap-2">
                      <span className="flex w-[16px] shrink-0 items-center justify-center">
                        {done ? (
                          <Check
                            size={14}
                            strokeWidth={1.75}
                            aria-hidden="true"
                            className="text-ink-display"
                          />
                        ) : (
                          <LiveDot live={current && advancing} />
                        )}
                      </span>
                      {/* Every marker is paired with its label. A dot on its own
                          would be decoration claiming to be information. */}
                      <span
                        className={cn(
                          "text-[14px]",
                          done || current ? "text-ink" : "text-ink-faint",
                        )}
                      >
                        {t(`status.steps.${step}`)}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {snapshot !== null && (status === "extracting" || status === "cost_paused") ? (
                <p className="font-mono text-[12px] tabular-nums text-ink-muted">
                  {t("status.framesRead", {
                    done: snapshot.jobs.done,
                    total: snapshot.frameCount,
                  })}
                </p>
              ) : null}
            </Plate>
          </>
        )}
      </section>

      {/* Outside the live region above, on purpose: `Notice` carries its own
          `role="status"` for warn and stop, and a live region nested inside a
          live region is announced twice or not at all depending on the screen
          reader. These change rarely; the region above changes every poll. */}
      {status === "cost_paused" ? (
        <Notice tone="warn" title={t("status.paused.title")}>
          {t("status.paused.body")}
        </Notice>
      ) : null}

      {status === "failed" ? (
        <Notice tone="stop" title={t("status.failedNotice.title")}>
          {t("status.failedNotice.body")}
        </Notice>
      ) : null}

      {snapshot !== null && snapshot.jobs.failed > 0 && status !== "failed" ? (
        <Notice tone="warn">{t("status.framesFailed", { count: snapshot.jobs.failed })}</Notice>
      ) : null}

      {rollups.length > 0 ? (
        <section className="flex flex-col gap-3">
          <Eyebrow>{t("status.segmentsEyebrow")}</Eyebrow>
          <p className="text-[13px] leading-relaxed text-neutral-strong">
            {t("status.segmentsLead", { count: rollups.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {rollups.map((rollup) => (
              <li
                key={rollup.segmentId}
                className="flex items-baseline justify-between gap-3 rounded-[2px] border border-border bg-surface-elevated px-3 py-2"
              >
                <span className="truncate font-mono text-[12px] text-ink">{rollup.segmentId}</span>
                {/* Coverage is 0..1 from lib/capture/rollup. Rounded to a whole
                    percent: three decimals of a ratio is a number for the
                    reviewer's table, not for the person who walked the street. */}
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
                  {t("status.segmentCoverage", {
                    percent: Math.round(Math.max(0, Math.min(1, rollup.coverage)) * 100),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[13px] leading-relaxed text-ink-muted">{t("status.waitNote")}</p>
    </div>
  );
}
