"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileUp,
  Upload,
} from "lucide-react";

/* Shapes shared with app/api/admin/import/route.ts (kept in lockstep). */
type IssueCode = "bbox" | "duplicate" | "schema";
type Issue = { code: IssueCode; message?: string };
type PreviewRow = {
  index: number;
  name: string | null;
  highway: string | null;
  status: "valid" | "invalid" | "duplicate";
  issues: Issue[];
};
type Summary = {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  outOfBounds: number;
};
type Preview = { rows: PreviewRow[]; summary: Summary };

type Phase = "idle" | "validating" | "committing";

/**
 * Bulk-import panel: choose a file → dry-run validation preview (zero side
 * effects) → explicit commit through the apply pipeline. All validation runs on
 * the server; the client only holds the raw file text and the preview.
 */
export default function ImportPanel({
  localMode,
}: Readonly<{ localMode: boolean }>) {
  const t = useTranslations("admin.import");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [filename, setFilename] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verified, setVerified] = useState(false);
  const [auditor, setAuditor] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const busy = phase !== "idle";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);
    setImported(null);
    setFilename(file.name);
    try {
      setContent(await file.text());
    } catch {
      setContent(null);
      setError(t("errorParse"));
    }
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | (Record<string, unknown> & { error?: string })
      | null;
    return { ok: res.ok, data };
  }

  async function validate() {
    if (!content) return;
    setPhase("validating");
    setError(null);
    setImported(null);
    const { ok, data } = await post({ action: "validate", content, filename });
    setPhase("idle");
    if (!ok || !data || !data.rows) {
      setError(data?.error === "parse" ? t("errorParse") : t("errorGeneric"));
      setPreview(null);
      return;
    }
    setPreview({ rows: data.rows as PreviewRow[], summary: data.summary as Summary });
  }

  async function commit() {
    if (!content || !preview || preview.summary.valid === 0) return;
    if (verified && auditor.trim().length === 0) {
      setError(t("auditorRequired"));
      return;
    }
    setPhase("committing");
    setError(null);
    const { ok, data } = await post({
      action: "commit",
      content,
      filename,
      verified,
      auditor: verified ? auditor.trim() : null,
    });
    setPhase("idle");
    if (!ok || !data || typeof data.imported !== "number") {
      setError(t("errorGeneric"));
      return;
    }
    setImported(data.imported);
    setPreview(null);
    setContent(null);
    setFilename(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const canCommit = !!preview && preview.summary.valid > 0 && !busy;

  return (
    <div className="flex flex-col gap-5">
      {localMode ? (
        <p className="rounded-[8px] border border-border bg-surface-sunken px-3 py-2 text-[12px] text-neutral-strong">
          {t("localNote")}
        </p>
      ) : null}

      {/* Upload + options */}
      <section className="rounded-[8px] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]">
        <label className="block text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("fileLabel")}
        </label>
        <p className="mt-1 mb-3 text-[12px] text-neutral-strong">{t("fileHint")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-[4px] border border-border bg-surface-elevated px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-border-strong focus-within:ring-2 focus-within:ring-ink">
            <FileUp size={15} strokeWidth={1.75} aria-hidden="true" />
            {filename ?? t("fileLabel")}
            <input
              ref={inputRef}
              type="file"
              accept=".json,.geojson,.csv,application/json,text/csv"
              onChange={onFile}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            onClick={validate}
            disabled={!content || busy}
            className="inline-flex items-center gap-1.5 rounded-[4px] bg-ink-display px-3 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "validating" ? t("validating") : t("dryRun")}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="size-4 accent-ink"
            />
            {t("verifiedLabel")}
          </label>
          <p className="text-[11.5px] text-neutral-strong">{t("verifiedHint")}</p>
          {verified ? (
            <div className="mt-1">
              <label className="block text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                {t("auditorLabel")}
              </label>
              <input
                type="text"
                value={auditor}
                onChange={(e) => setAuditor(e.target.value)}
                placeholder={t("auditorPlaceholder")}
                className="mt-1 w-full max-w-xs rounded-[4px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[13px] text-ink focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              />
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="inline-flex items-center gap-2 rounded-[8px] border border-clay/40 bg-clay/10 px-3 py-2 text-[12.5px] text-clay">
          <CircleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {imported !== null ? (
        <p className="inline-flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3 py-2 text-[12.5px] text-ink">
          <CheckCircle2
            size={15}
            strokeWidth={1.75}
            className="text-ink"
            aria-hidden="true"
          />
          {t("commitSuccess", { count: imported })}
        </p>
      ) : null}

      {/* Preview */}
      {!preview ? (
        imported === null ? (
          <p className="rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-4 py-6 text-center text-[12.5px] text-neutral-strong">
            {t("emptyState")}
          </p>
        ) : null
      ) : (
        <section className="rounded-[8px] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("previewHeading")}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              <SummaryChip tone="ok" label={t("summaryValid", { count: preview.summary.valid })} />
              {preview.summary.duplicate > 0 ? (
                <SummaryChip tone="warn" label={t("summaryDuplicate", { count: preview.summary.duplicate })} />
              ) : null}
              {preview.summary.outOfBounds > 0 ? (
                <SummaryChip tone="warn" label={t("summaryOutOfBounds", { count: preview.summary.outOfBounds })} />
              ) : null}
              {preview.summary.invalid > 0 ? (
                <SummaryChip tone="bad" label={t("summaryInvalid", { count: preview.summary.invalid })} />
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-mono uppercase tracking-[0.14em] text-neutral-strong">
                  <th className="py-1.5 pr-3 font-semibold">{t("colRow")}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t("colName")}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t("colHighway")}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t("colStatus")}</th>
                  <th className="py-1.5 font-semibold">{t("colIssues")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.index} className="border-b border-border/70 align-top">
                    <td className="py-1.5 pr-3 font-mono text-neutral-strong">
                      {row.index + 1}
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{row.name ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono text-neutral-strong">
                      {row.highway ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatusPill status={row.status} label={t(statusKey(row.status))} />
                    </td>
                    <td className="py-1.5 text-[11.5px] text-neutral-strong">
                      {row.issues.length === 0
                        ? "—"
                        : row.issues.map((iss, i) => (
                            <span key={i} className="mr-2 inline-block">
                              {iss.code === "bbox"
                                ? t("issueBbox")
                                : iss.code === "duplicate"
                                  ? t("issueDuplicate")
                                  : (iss.message ?? "")}
                            </span>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            {preview.summary.valid === 0 ? (
              <p className="inline-flex items-center gap-2 text-[12.5px] text-neutral-strong">
                <AlertTriangle size={15} strokeWidth={1.75} aria-hidden="true" />
                {t("noValid")}
              </p>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={commit}
              disabled={!canCommit}
              className="inline-flex items-center gap-1.5 rounded-[4px] bg-ink-display px-3.5 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload size={15} strokeWidth={1.75} aria-hidden="true" />
              {phase === "committing"
                ? t("committing")
                : t("commit", { count: preview.summary.valid })}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function statusKey(
  status: PreviewRow["status"],
): "statusValid" | "statusDuplicate" | "statusInvalid" {
  return status === "valid"
    ? "statusValid"
    : status === "duplicate"
      ? "statusDuplicate"
      : "statusInvalid";
}

function StatusPill({
  status,
  label,
}: Readonly<{ status: PreviewRow["status"]; label: string }>) {
  const tone =
    status === "valid"
      ? "border-hairline-strong text-ink"
      : status === "duplicate"
        ? "border-border-strong text-neutral-strong"
        : "border-clay/40 text-clay";
  return (
    <span
      className={`inline-flex rounded-[4px] border px-1.5 py-0.5 font-mono text-[11px] ${tone}`}
    >
      {label}
    </span>
  );
}

function SummaryChip({
  tone,
  label,
}: Readonly<{ tone: "ok" | "warn" | "bad"; label: string }>) {
  const cls =
    tone === "ok"
      ? "border-hairline-strong text-ink"
      : tone === "warn"
        ? "border-border-strong text-neutral-strong"
        : "border-clay/40 text-clay";
  return (
    <span className={`inline-flex rounded-[4px] border px-1.5 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}
