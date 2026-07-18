"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Activity, Play, RefreshCw, TriangleAlert } from "lucide-react";
import type { OpsDashboardData } from "@/lib/ops/ops-store";
import type { ModelCorrectionStat } from "@/lib/ops/model-quality";
import { RUBRIC_ITEM_KEYS } from "@/lib/capture/types";
import styles from "@/components/ui/zen.module.css";

const numFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

function sessionStatusLabel(
  t: ReturnType<typeof useTranslations<"admin.ops">>,
  status: string,
): string {
  const known = [
    "pending_upload",
    "uploading",
    "matching",
    "extracting",
    "cost_paused",
    "review_ready",
    "approved",
    "rejected",
    "failed",
  ] as const;
  if ((known as readonly string[]).includes(status)) {
    return t(`status.${status as (typeof known)[number]}`);
  }
  return status;
}

function tokenTotal(s: OpsDashboardData["sessions"][number]): number {
  const tok = s.tokens;
  return (
    tok.extractionInput +
    tok.extractionOutput +
    tok.synthesisInput +
    tok.synthesisOutput
  );
}

function SessionActions({
  sessionId,
  status,
  locale,
}: Readonly<{ sessionId: string; status: string; locale: string }>) {
  const t = useTranslations("admin.ops");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function resume() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setResult(t("resumeReasonRequired"));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/capture/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, reason: trimmed }),
      });
      if (res.ok) {
        const body = (await res.json()) as { requeued?: number };
        setResult(t("resumeSuccess", { count: body.requeued ?? 0 }));
        return;
      }
      setResult(t("actionError"));
    } catch {
      setResult(t("actionError"));
    } finally {
      setBusy(false);
    }
  }

  async function reprocess(dryRun: boolean) {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/capture/reprocess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, dry_run: dryRun }),
      });
      const body = (await res.json()) as {
        attributed?: number;
        total?: number;
        reprocessed?: number;
        requeued?: number;
        error?: string;
      };
      if (res.ok) {
        if (dryRun) {
          setResult(
            t("reprocessPreview", {
              attributed: body.attributed ?? 0,
              total: body.total ?? 0,
            }),
          );
        } else {
          setResult(
            t("reprocessSuccess", {
              reprocessed: body.reprocessed ?? 0,
              requeued: body.requeued ?? 0,
            }),
          );
        }
        return;
      }
      setResult(t("actionError"));
    } catch {
      setResult(t("actionError"));
    } finally {
      setBusy(false);
    }
  }

  const canResume = status === "cost_paused";
  const canReprocess = status === "extracting" || status === "review_ready";

  if (!canResume && !canReprocess) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      {canResume ? (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("resumeReasonPlaceholder")}
            className="rounded-[4px] border border-border bg-surface-base px-2 py-1 text-[12px]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void resume()}
            className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border border-border px-2 py-1 text-[11px] font-medium`}
          >
            <Play size={12} />
            {t("resume")}
          </button>
        </div>
      ) : null}
      {canReprocess ? (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void reprocess(true)}
            className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border border-border px-2 py-1 text-[11px] font-medium`}
          >
            <RefreshCw size={12} />
            {t("reprocessPreviewBtn")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("reprocessConfirm"))) void reprocess(false);
            }}
            className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border border-border-strong px-2 py-1 text-[11px] font-semibold`}
          >
            {t("reprocessCommit")}
          </button>
        </div>
      ) : null}
      {result ? <p className="text-[11px] text-neutral-strong">{result}</p> : null}
      <Link
        href={`/${locale}/admin/capture/${sessionId}`}
        className="text-[11px] font-medium text-accent hover:underline"
      >
        {t("openReview")}
      </Link>
    </div>
  );
}

function ModelTable({ rows }: Readonly<{ rows: ModelCorrectionStat[] }>) {
  const t = useTranslations("admin.ops");
  if (rows.length === 0) {
    return <p className="text-[13px] text-neutral-strong">{t("noModelData")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
            <th className="px-3 py-2">{t("colModel")}</th>
            <th className="px-3 py-2 text-right">{t("colObservations")}</th>
            <th className="px-3 py-2 text-right">{t("colCorrected")}</th>
            <th className="px-3 py-2 text-right">{t("colCorrectionRate")}</th>
            <th className="px-3 py-2">{t("colTopOverrides")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const topItems = RUBRIC_ITEM_KEYS.map((key) => ({
              key,
              count: row.itemOverrides[key] ?? 0,
            }))
              .filter((x) => x.count > 0)
              .sort((a, b) => b.count - a.count)
              .slice(0, 3);
            return (
              <tr key={row.model} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-mono text-ink">{row.model}</td>
                <td className="px-3 py-2 text-right font-mono">{row.observations}</td>
                <td className="px-3 py-2 text-right font-mono">{row.humanCorrected}</td>
                <td className="px-3 py-2 text-right font-mono">{pctFmt.format(row.correctionRate)}</td>
                <td className="px-3 py-2 text-neutral-strong">
                  {topItems.length === 0
                    ? t("none")
                    : topItems.map((x) => `${x.key} (${x.count})`).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OpsDashboard({
  data,
  locale,
}: Readonly<{ data: OpsDashboardData; locale: string }>) {
  const t = useTranslations("admin.ops");
  const health = data.health;

  return (
    <div className="flex flex-col gap-6">
      {data.source === "empty" ? (
        <p className="rounded-[8px] border border-dashed border-border bg-surface-sunken px-4 py-3 text-[13px] text-neutral-strong">
          {t("localNote")}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated px-4 py-3`}>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-neutral-strong">{t("tile.costPaused")}</p>
          <p className="mt-1 font-mono text-[1.6rem] font-semibold text-amber">{numFmt.format(health?.cost_paused ?? 0)}</p>
        </div>
        <div className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated px-4 py-3`}>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-neutral-strong">{t("tile.stuckJobs")}</p>
          <p className="mt-1 font-mono text-[1.6rem] font-semibold text-clay">{numFmt.format(health?.stuck_running_jobs ?? 0)}</p>
        </div>
        <div className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated px-4 py-3`}>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-neutral-strong">{t("tile.failedJobs")}</p>
          <p className="mt-1 font-mono text-[1.6rem] font-semibold text-clay">{numFmt.format(health?.failed_jobs ?? 0)}</p>
        </div>
        <div className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated px-4 py-3`}>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-neutral-strong">{t("tile.pendingJobs")}</p>
          <p className="mt-1 font-mono text-[1.6rem] font-semibold text-ink">{numFmt.format(health?.pending_jobs ?? 0)}</p>
        </div>
      </section>

      <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-4`}>
        <h2 className="flex items-center gap-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          <Activity size={14} />
          {t("spendHeading")}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] text-neutral-strong">{t("extractionTokens")}</dt>
            <dd className="font-mono text-[1.1rem] font-semibold text-ink">
              {numFmt.format(data.totals.extractionTokens)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-neutral-strong">{t("synthesisTokens")}</dt>
            <dd className="font-mono text-[1.1rem] font-semibold text-ink">
              {numFmt.format(data.totals.synthesisTokens)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-neutral-strong">{t("escalationRate")}</dt>
            <dd className="font-mono text-[1.1rem] font-semibold text-ink">
              {pctFmt.format(data.totals.escalationRate)}
            </dd>
          </div>
        </dl>
        {data.dailySpend.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border text-left font-mono uppercase tracking-[0.1em] text-neutral-strong">
                  <th className="px-2 py-1.5">{t("colDay")}</th>
                  <th className="px-2 py-1.5 text-right">{t("colExtraction")}</th>
                  <th className="px-2 py-1.5 text-right">{t("colSynthesis")}</th>
                </tr>
              </thead>
              <tbody>
                {data.dailySpend.map((d) => (
                  <tr key={d.day} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1.5 font-mono">{d.day}</td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {numFmt.format(d.extractionInput + d.extractionOutput)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {numFmt.format(d.synthesisInput + d.synthesisOutput)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-4`}>
        <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("sessionsHeading")}
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
                <th className="px-3 py-2">{t("colSession")}</th>
                <th className="px-3 py-2">{t("colStatus")}</th>
                <th className="px-3 py-2 text-right">{t("colFrames")}</th>
                <th className="px-3 py-2 text-right">{t("colTokens")}</th>
                <th className="px-3 py-2 text-right">{t("colEscalated")}</th>
                <th className="px-3 py-2">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.sessionId} className="border-b border-border align-top last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[11px] text-ink">
                    {s.sessionId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      {s.status === "cost_paused" ? (
                        <TriangleAlert size={12} className="text-amber" aria-hidden="true" />
                      ) : null}
                      {sessionStatusLabel(t, s.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{s.frameCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{numFmt.format(tokenTotal(s))}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.tokens.escalated}</td>
                  <td className="px-3 py-2">
                    <SessionActions sessionId={s.sessionId} status={s.status} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-4`}>
        <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("modelQualityHeading")}
        </h2>
        <ModelTable rows={data.modelQuality.byModel} />
        {data.modelQuality.trend.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
              {t("trendHeading")}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.modelQuality.trend.map((row) => (
                <li
                  key={row.month}
                  className="rounded-[4px] border border-border bg-surface-sunken px-2 py-1 text-[11px] font-mono"
                >
                  {row.month}: {pctFmt.format(row.correctionRate)} ({row.count})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
