"use client";

/**
 * One frame, up close (u2).
 *
 * The reviewer's window into a single frame: what the model read on all fifteen
 * rubric items (value AND confidence, with a null shown as "not assessable", never
 * as a zero), the reasoning it gave, and whether it escalated. From here the
 * reviewer can correct any item's value, exclude the frame from scoring, or delete
 * it for privacy — each change flowing straight back into the live recompute.
 *
 * Every reading is presented as the model's, editable but clearly the model's until
 * a person changes it; an override shows its diff from the original so nothing is
 * silently rewritten.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, Maximize2, RotateCcw, Trash2, TriangleAlert, X, Zap } from "lucide-react";
import {
  RUBRIC_ITEM_KEYS,
  RUBRIC_ITEM_RESPONSE_TYPES,
  type RubricItemKey,
} from "@/lib/capture/types";
import type { ReviewFrame } from "@/lib/capture/review-store";
import styles from "@/components/ui/zen.module.css";

/** The override options offered per response type, in raw rubric units. */
const SCALE_OPTIONS = [0, 1, 2, 3, 4];
const PERCENT_OPTIONS = [0, 20, 40, 60, 80, 100];

type ItemOverrides = Partial<Record<RubricItemKey, number | null>>;

function formatModelValue(
  key: RubricItemKey,
  value: number | null,
  t: ReturnType<typeof useTranslations>,
): string {
  if (value === null || value === undefined) return t("notAssessable");
  const rt = RUBRIC_ITEM_RESPONSE_TYPES[key];
  if (rt === "boolean") return value > 0 ? t("boolYes") : t("boolNo");
  if (rt === "percent") return `${Math.round(value)}%`;
  return `${value}/4`;
}

export default function FrameInspector({
  frame,
  overrides,
  excluded,
  onOverrideItem,
  onToggleExclude,
  onDelete,
  onResetFrame,
  onExpandImage,
  onClose,
}: Readonly<{
  frame: ReviewFrame;
  overrides: ItemOverrides | undefined;
  excluded: boolean;
  onOverrideItem: (key: RubricItemKey, value: number | null | undefined) => void;
  onToggleExclude: () => void;
  onDelete: () => void;
  onResetFrame: () => void;
  onExpandImage: () => void;
  onClose: () => void;
}>) {
  const t = useTranslations("admin.capture");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const obs = frame.observation;
  const overrideCount = useMemo(
    () => (overrides ? Object.keys(overrides).length : 0),
    [overrides],
  );

  return (
    <div
      role="group"
      aria-label={t("inspectorTitle", { seq: frame.seq })}
      className={`${styles.plate} flex flex-col gap-3 rounded-[8px] border border-border-strong bg-surface-elevated p-4`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("inspectorTitle", { seq: frame.seq })}
        </h3>
        {frame.deleted ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-clay/45 bg-clay/10 px-2 py-0.5 text-[10.5px] font-medium text-clay">
            <Trash2 size={11} strokeWidth={2} aria-hidden="true" />
            {t("frameDeleted")}
          </span>
        ) : excluded ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-border-strong bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-neutral-strong">
            <Ban size={11} strokeWidth={2} aria-hidden="true" />
            {t("frameExcluded")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeInspector")}
          className={`${styles.control} ml-auto inline-flex size-6 items-center justify-center rounded-[4px] border border-border text-neutral-strong hover:text-ink`}
        >
          <X size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-mono text-neutral-strong">
          {frame.segmentId ?? t("unmatched")}
        </span>
        {obs ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-neutral-strong">
            {obs.model}
          </span>
        ) : null}
        {frame.nearJunction ? (
          <span className="rounded-[4px] border border-border bg-surface-sunken px-1.5 py-0.5 font-medium text-neutral-strong">
            {t("atJunction")}
          </span>
        ) : null}
        {!frame.usable ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber/45 bg-amber/10 px-1.5 py-0.5 font-medium text-ink">
            <TriangleAlert size={11} strokeWidth={2} aria-hidden="true" />
            {t("notUsable")}
          </span>
        ) : null}
        {frame.jobStatus && frame.jobStatus !== "done" ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-clay/45 bg-clay/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-clay">
            {frame.jobStatus}
          </span>
        ) : null}
        {obs?.escalated ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-border bg-surface-sunken px-1.5 py-0.5 font-medium text-neutral-strong">
            <Zap size={11} strokeWidth={2} aria-hidden="true" />
            {t("escalatedLabel")}
          </span>
        ) : null}
      </div>

      {frame.deleted ? (
        <p className="rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-3 py-4 text-center text-[12px] text-neutral-strong">
          {t("frameDeletedNote")}
        </p>
      ) : !obs ? (
        <div className="flex flex-col gap-2">
          {frame.jobError ? (
            <p className="rounded-[4px] border border-clay/45 bg-clay/10 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-clay">
              {frame.jobError}
            </p>
          ) : null}
          <p className="rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-3 py-4 text-center text-[12px] text-neutral-strong">
            {t("noReading")}
          </p>
        </div>
      ) : (
        <>
          {frame.url ? (
            <button
              type="button"
              onClick={onExpandImage}
              aria-label={t("enlargeFrame", { seq: frame.seq })}
              data-expand-seq={frame.seq}
              className={`${styles.control} group relative block w-full overflow-hidden rounded-[4px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frame.url}
                alt={t("frameAlt", { seq: frame.seq })}
                loading="lazy"
                decoding="async"
                className="max-h-40 w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 inline-flex size-6 items-center justify-center rounded-[4px] border border-ink/20 bg-surface/85 text-ink opacity-80 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <Maximize2 size={13} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          ) : null}

          {obs.rationale ? (
            <p className="rounded-[4px] border border-border bg-surface-sunken px-3 py-2 text-[12.5px] leading-relaxed text-ink">
              {obs.rationale}
            </p>
          ) : null}

          {frame.jobError && frame.jobStatus !== "done" ? (
            <p className="rounded-[4px] border border-clay/45 bg-clay/10 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-clay">
              {frame.jobError}
            </p>
          ) : null}

          <ul className="flex flex-col divide-y divide-border rounded-[4px] border border-border">
            {RUBRIC_ITEM_KEYS.map((key) => {
              const item = obs.items?.[key];
              const modelValue = item?.value ?? null;
              const hasOverride =
                overrides && Object.prototype.hasOwnProperty.call(overrides, key);
              const overrideValue = hasOverride ? overrides[key] ?? null : undefined;
              const rt = RUBRIC_ITEM_RESPONSE_TYPES[key];
              const selectValue =
                overrideValue === undefined
                  ? ""
                  : overrideValue === null
                    ? "null"
                    : String(overrideValue);
              const options =
                rt === "boolean"
                  ? [1, 0]
                  : rt === "percent"
                    ? PERCENT_OPTIONS
                    : SCALE_OPTIONS;

              return (
                <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                  <span className="font-mono text-[11px] text-ink">{key}</span>
                  <span
                    className={`font-mono text-[11px] ${hasOverride ? "text-neutral-strong line-through" : "text-neutral-strong"}`}
                  >
                    {formatModelValue(key, modelValue, t)}
                  </span>
                  {item && item.confidence !== undefined && !hasOverride ? (
                    <span className="font-mono text-[10px] text-neutral">
                      {Math.round(item.confidence * 100)}%
                    </span>
                  ) : null}
                  {hasOverride ? (
                    <span className="inline-flex items-center gap-1 rounded-[3px] border border-pine/45 bg-pine/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-pine">
                      {formatModelValue(key, overrideValue ?? null, t)}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <label className="sr-only" htmlFor={`ov-${frame.seq}-${key}`}>
                      {t("overrideItemLabel", { item: key })}
                    </label>
                    <select
                      id={`ov-${frame.seq}-${key}`}
                      value={selectValue}
                      disabled={excluded || frame.deleted}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") onOverrideItem(key, undefined);
                        else if (v === "null") onOverrideItem(key, null);
                        else onOverrideItem(key, Number(v));
                      }}
                      className="rounded-[3px] border border-border bg-surface-base px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-50"
                    >
                      <option value="">{t("overrideModel")}</option>
                      {options.map((o) => (
                        <option key={o} value={String(o)}>
                          {formatModelValue(key, o, t)}
                        </option>
                      ))}
                      <option value="null">{t("notAssessable")}</option>
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!frame.deleted ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleExclude}
            aria-pressed={excluded}
            className={`${styles.control} inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[12px] font-medium ${
              excluded
                ? "border-border-strong bg-surface-sunken text-ink"
                : "border-border text-neutral-strong hover:text-ink"
            }`}
          >
            <Ban size={13} strokeWidth={1.75} aria-hidden="true" />
            {excluded ? t("includeFrame") : t("excludeFrame")}
          </button>

          {overrideCount > 0 || excluded ? (
            <button
              type="button"
              onClick={onResetFrame}
              className={`${styles.control} inline-flex items-center gap-1.5 rounded-[4px] border border-border px-2.5 py-1 text-[12px] font-medium text-neutral-strong hover:text-ink`}
            >
              <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
              {t("resetFrame")}
            </button>
          ) : null}

          {confirmingDelete ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[11.5px] font-medium text-clay">{t("deleteConfirm")}</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete();
                }}
                className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border border-clay/45 bg-clay/10 px-2 py-1 text-[12px] font-semibold text-clay hover:bg-clay/20`}
              >
                <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                {t("deleteConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className={`${styles.control} rounded-[4px] border border-border px-2 py-1 text-[12px] font-medium text-neutral-strong hover:text-ink`}
              >
                {t("cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={`${styles.control} ml-auto inline-flex items-center gap-1.5 rounded-[4px] border border-clay/45 px-2.5 py-1 text-[12px] font-medium text-clay hover:bg-clay/10`}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              {t("deleteFrame")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
