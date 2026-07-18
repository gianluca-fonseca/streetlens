"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, FlaskConical, HelpCircle, PencilLine, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { SubmissionStatus } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import styles from "@/components/ui/zen.module.css";

/**
 * One history row, prepared by the (server) history page. Payload parsing stays
 * on the server: the client receives only the display-ready fields, so an
 * unreadable/invalid submission arrives with `payloadReadable: false` and no
 * `sessionId`, and the row renders honestly instead of guessing.
 */
export type HistoryRowView = {
  id: string;
  type: "add_segment" | "update_segment" | "cv_capture" | "unknown";
  status: SubmissionStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
  /** The camera-walk session, when this is a readable cv_capture. */
  sessionId?: string | null;
  /** A short human detail: the proposed name, or the target segment id. */
  detail?: string | null;
  payloadReadable: boolean;
};

export type HistoryCounts = {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
};

type StatusFilter = "all" | SubmissionStatus;
type TypeFilter = "all" | "add_segment" | "update_segment" | "cv_capture";

/** How long a reviewer note gets before it needs the expander. */
const NOTE_CLAMP = 140;

export default function HistoryList({
  rows,
  counts,
  isSample,
  total,
  cap,
}: Readonly<{
  rows: HistoryRowView[];
  counts: HistoryCounts;
  isSample: boolean;
  total: number;
  cap: number;
}>) {
  const t = useTranslations("admin.history");
  const ts = useTranslations("admin.status");
  const locale = useLocale();

  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  // Type-filter counts come from the rows themselves (the rows ARE the full
  // reconciled set up to the cap), so they can never disagree with what shows.
  const typeCounts = useMemo(() => {
    const c: Record<TypeFilter, number> = {
      all: rows.length,
      add_segment: 0,
      update_segment: 0,
      cv_capture: 0,
    };
    for (const r of rows) {
      if (r.type in c) c[r.type as TypeFilter] += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === "all" || r.status === status) &&
          (type === "all" || r.type === type),
      ),
    [rows, status, type],
  );

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: t("filterAll"), count: counts.total },
    { key: "pending", label: ts("pending"), count: counts.pending },
    { key: "approved", label: ts("approved"), count: counts.approved },
    { key: "rejected", label: ts("rejected"), count: counts.rejected },
  ];

  const typeTabs: { key: TypeFilter; label: string; count: number }[] = [
    { key: "all", label: t("filterAllTypes"), count: typeCounts.all },
    { key: "add_segment", label: t("typeAdd"), count: typeCounts.add_segment },
    {
      key: "update_segment",
      label: t("typeUpdate"),
      count: typeCounts.update_segment,
    },
    { key: "cv_capture", label: t("typeCapture"), count: typeCounts.cv_capture },
  ];

  if (rows.length === 0) {
    return (
      <p className="rounded-[8px] border border-dashed border-border-strong bg-surface-elevated px-4 py-8 text-center text-[13px] text-neutral-strong">
        {t("empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isSample ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3.5 py-2 text-[12.5px] font-medium text-ink"
        >
          <FlaskConical
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-amber"
            aria-hidden="true"
          />
          <span>{t("localNote")}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <FilterRow
          label={t("filterStatusLabel")}
          tabs={statusTabs}
          active={status}
          onSelect={(k) => setStatus(k as StatusFilter)}
        />
        <FilterRow
          label={t("filterTypeLabel")}
          tabs={typeTabs}
          active={type}
          onSelect={(k) => setType(k as TypeFilter)}
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-[8px] border border-dashed border-border-strong bg-surface-elevated px-4 py-8 text-center text-[13px] text-neutral-strong">
          {t("noneShown")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((r) => {
            const note = r.reviewerNote?.trim() ?? "";
            const longNote = note.length > NOTE_CLAMP;
            const isOpen = expanded[r.id] ?? false;
            const shownNote =
              longNote && !isOpen ? `${note.slice(0, NOTE_CLAMP)}…` : note;
            return (
              <li key={r.id}>
                <article
                  className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-3.5`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status} label={ts(r.status)} />
                    <TypeBadge type={r.type} t={t} />
                    {r.detail ? (
                      <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">
                        {r.detail}
                      </span>
                    ) : !r.payloadReadable ? (
                      <span className="text-[12px] italic text-neutral-strong">
                        {t("unreadablePayload")}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-neutral-strong">
                      {t("submittedAt")} {dateFmt.format(new Date(r.createdAt))}
                    </span>
                  </div>

                  <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-neutral-strong">{t("reviewedAt")}</dt>
                    <dd className="text-ink">
                      {r.reviewedAt ? (
                        <span className="font-mono text-[11.5px]">
                          {dateFmt.format(new Date(r.reviewedAt))}
                        </span>
                      ) : (
                        <span className="text-neutral-strong">
                          {t("notReviewed")}
                        </span>
                      )}
                    </dd>

                    <dt className="text-neutral-strong">{t("reviewerNote")}</dt>
                    <dd className="text-ink">
                      {note ? (
                        <Fragment>
                          <span className="whitespace-pre-wrap">{shownNote}</span>
                          {longNote ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((e) => ({ ...e, [r.id]: !isOpen }))
                              }
                              className="ml-1.5 font-medium text-neutral-strong underline decoration-dotted underline-offset-2 hover:text-ink"
                            >
                              {isOpen ? t("showLess") : t("showMore")}
                            </button>
                          ) : null}
                        </Fragment>
                      ) : (
                        <span className="text-neutral-strong">{t("noNote")}</span>
                      )}
                    </dd>
                  </dl>

                  {r.type === "cv_capture" && r.sessionId ? (
                    <div className="mt-2.5">
                      <Link
                        href={`/admin/capture/${r.sessionId}`}
                        className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:border-border-strong"
                      >
                        <Camera size={13} strokeWidth={1.75} aria-hidden="true" />
                        {t("captureLink")}
                      </Link>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11.5px] leading-snug text-neutral-strong">
        {total > cap
          ? t("footerCap", { count: rows.length, total })
          : t("footerAll", { count: rows.length })}
      </p>
    </div>
  );
}

function FilterRow({
  label,
  tabs,
  active,
  onSelect,
}: Readonly<{
  label: string;
  tabs: { key: string; label: string; count: number }[];
  active: string;
  onSelect: (key: string) => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[10.5px] font-mono font-medium uppercase tracking-[0.14em] text-neutral-strong">
        {label}
      </span>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(tab.key)}
            className={[
              "inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[12px] font-medium transition-colors",
              isActive
                ? "border-border-strong bg-surface-sunken text-ink"
                : "border-border bg-surface-elevated text-neutral-strong hover:border-border-strong hover:text-ink",
            ].join(" ")}
          >
            {tab.label}
            <span className="font-mono text-[11px] text-neutral-strong">
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TypeBadge({
  type,
  t,
}: Readonly<{
  type: HistoryRowView["type"];
  t: ReturnType<typeof useTranslations<"admin.history">>;
}>) {
  const { Icon, label } =
    type === "cv_capture"
      ? { Icon: Camera, label: t("typeCapture") }
      : type === "add_segment"
        ? { Icon: Plus, label: t("typeAdd") }
        : type === "update_segment"
          ? { Icon: PencilLine, label: t("typeUpdate") }
          : { Icon: HelpCircle, label: t("typeUnknown") };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-neutral-strong">
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
