"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, FlaskConical, Plus, PencilLine, X } from "lucide-react";
import StatusBadge from "./StatusBadge";
import GeometryPreview from "./GeometryPreview";
import styles from "@/components/ui/zen.module.css";

/** A queue item prepared by the (server) queue page for display. */
export type QueueItemView = {
  id: string;
  type: "add_segment" | "update_segment";
  createdAt: string;
  geometry: [number, number][];
  proposed: { name?: string; highway?: string; note?: string | null };
  current?: {
    name?: string | null;
    highway?: string | null;
    note?: string | null;
  };
  contributorReason?: string | null;
};

const DIFF_FIELDS = ["name", "highway", "note"] as const;
type DiffField = (typeof DIFF_FIELDS)[number];

export default function QueueList({
  items,
  isSample,
}: Readonly<{
  items: QueueItemView[];
  isSample: boolean;
}>) {
  const t = useTranslations("admin.queue");
  const ts = useTranslations("admin.status");
  const locale = useLocale();
  const router = useRouter();

  const [list, setList] = useState(items);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  async function review(id: string, action: "approve" | "reject") {
    const reason = (reasons[id] ?? "").trim();
    if (reason.length === 0) {
      setErrors((e) => ({ ...e, [id]: t("reasonRequired") }));
      return;
    }
    setErrors((e) => ({ ...e, [id]: "" }));
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      if (res.ok) {
        setList((l) => l.filter((i) => i.id !== id));
        router.refresh();
        return;
      }
      setErrors((e) => ({ ...e, [id]: t("errorGeneric") }));
    } catch {
      setErrors((e) => ({ ...e, [id]: t("errorGeneric") }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  if (list.length === 0) {
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

      {list.map((item) => {
        const isAdd = item.type === "add_segment";
        const changed = DIFF_FIELDS.filter(
          (f) => item.proposed[f as DiffField] !== undefined,
        );
        return (
          <article
            key={item.id}
            className={`${styles.plate} ${styles.plateInteractive} rounded-[8px] border border-border bg-surface-elevated p-4`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="pending" label={ts("pending")} />
              <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-neutral-strong">
                {isAdd ? (
                  <Plus size={12} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <PencilLine size={12} strokeWidth={2} aria-hidden="true" />
                )}
                {isAdd ? t("typeAdd") : t("typeUpdate")}
              </span>
              <span className="ml-auto font-mono text-[11.5px] text-neutral-strong">
                {t("submittedAt")} {dateFmt.format(new Date(item.createdAt))}
              </span>
            </div>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <GeometryPreview
                coordinates={item.geometry}
                ariaLabel={t("previewLabel")}
                className="h-[76px] w-full shrink-0 sm:w-[132px]"
              />

              <div className="min-w-0 flex-1">
                {isAdd ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                    <dt className="text-neutral-strong">{t("fieldName")}</dt>
                    <dd className="font-medium text-ink">
                      {item.proposed.name}
                    </dd>
                    <dt className="text-neutral-strong">{t("fieldHighway")}</dt>
                    <dd className="font-mono text-ink">
                      {item.proposed.highway}
                    </dd>
                    {item.proposed.note ? (
                      <>
                        <dt className="text-neutral-strong">{t("fieldNote")}</dt>
                        <dd className="text-ink">{item.proposed.note}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : (
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                      {t("diffHeading")}
                    </h3>
                    <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead>
                        <tr className="text-left text-[10.5px] font-mono uppercase tracking-[0.14em] text-neutral-strong">
                          <th className="pb-1 pr-3 font-semibold" />
                          <th className="pb-1 pr-3 font-semibold">
                            {t("current")}
                          </th>
                          <th className="pb-1 font-semibold">{t("proposed")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changed.map((f) => {
                          const cur = item.current?.[f as DiffField];
                          const prop = item.proposed[f as DiffField];
                          const isMono = f === "highway";
                          return (
                            <tr
                              key={f}
                              className="border-t border-border align-top"
                            >
                              <td className="py-1 pr-3 text-neutral-strong">
                                {t(
                                  `field${f[0].toUpperCase()}${f.slice(1)}` as Parameters<
                                    typeof t
                                  >[0],
                                )}
                              </td>
                              <td
                                className={[
                                  "py-1 pr-3 text-neutral-strong",
                                  isMono ? "font-mono" : "",
                                ].join(" ")}
                              >
                                {cur ? cur : t("unset")}
                              </td>
                              <td
                                className={[
                                  "py-1 font-medium text-ink",
                                  isMono ? "font-mono" : "",
                                ].join(" ")}
                              >
                                {prop}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                    {item.contributorReason ? (
                      <p className="mt-2 text-[12px] text-neutral-strong">
                        <span className="font-medium text-ink">
                          {t("fieldReason")}:
                        </span>{" "}
                        {item.contributorReason}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 border-t border-border pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                  {t("reasonLabel")}
                </span>
                <textarea
                  rows={2}
                  value={reasons[item.id] ?? ""}
                  onChange={(e) =>
                    setReasons((r) => ({ ...r, [item.id]: e.target.value }))
                  }
                  placeholder={t("reasonPlaceholder")}
                  // 16px on phones prevents iOS focus auto-zoom; 13px returns at sm+.
                  className="resize-y rounded-[4px] border border-border bg-surface-base px-3 py-2 text-[16px] text-ink outline-none transition-colors placeholder:text-neutral focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]"
                />
              </label>

              {errors[item.id] ? (
                <p
                  role="alert"
                  className="mt-2 text-[12px] font-medium text-clay"
                >
                  {errors[item.id]}
                </p>
              ) : null}

              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => review(item.id, "approve")}
                  disabled={busy[item.id]}
                  className={`${styles.controlSoft} inline-flex items-center gap-1.5 rounded-[4px] bg-ink-display px-3 py-1.5 text-[12.5px] font-semibold text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  <Check size={14} strokeWidth={2.25} aria-hidden="true" />
                  {busy[item.id] ? t("working") : t("approve")}
                </button>
                <button
                  type="button"
                  onClick={() => review(item.id, "reject")}
                  disabled={busy[item.id]}
                  className={`${styles.control} inline-flex items-center gap-1.5 rounded-[4px] border border-clay/45 bg-clay/10 px-3 py-1.5 text-[12.5px] font-semibold text-clay hover:bg-clay/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  <X size={14} strokeWidth={2.25} aria-hidden="true" />
                  {busy[item.id] ? t("working") : t("reject")}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
