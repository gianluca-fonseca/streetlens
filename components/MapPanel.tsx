"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ScoreLayer, StreetStats } from "@/lib/segments";
import LayerSwitcher from "@/components/LayerSwitcher";
import Legend from "@/components/Legend";

/**
 * Floating primary map panel (the only 12px-radius surface, top elevation).
 * Holds the layer switcher, the legend, one live hero stat, and the mono
 * coverage figures. Data density is a feature.
 *
 * On phones the panel is COMPACT by default: it shows only the headline stat and
 * the layer switcher so the map stays visible, with a chevron to reveal the full
 * stats + legend. Desktop is unchanged — the toggle is `md:hidden` and the
 * collapsible blocks carry `md:block`, so the sealed layout never sees the
 * collapsed state.
 */
export default function MapPanel({
  stats,
  activeLayer,
  onSelectLayer,
}: Readonly<{
  stats: StreetStats;
  activeLayer: ScoreLayer;
  onSelectLayer: (layer: ScoreLayer) => void;
}>) {
  const t = useTranslations("panel");
  const [open, setOpen] = useState(false);
  const bodyClass = open ? "block" : "hidden md:block";

  const figures: { key: string; value: string; label: string }[] = [
    {
      key: "segments",
      value: String(stats.segments),
      label: t("segmentsLabel"),
    },
    {
      key: "km",
      value: `${stats.km.toFixed(1)}`,
      label: `${t("kmLabel")}`,
    },
    {
      key: "coverage",
      value: `${stats.coveragePct}%`,
      label: t("coverageLabel"),
    },
  ];

  return (
    <section
      aria-label={t("eyebrow")}
      className="pointer-events-auto flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-4 rounded-[12px] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]"
    >
      <header>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-ink-muted">
              {t("eyebrow")}
            </p>
            <p className="font-mono text-[2.15rem] font-medium leading-none tracking-tight text-accent-text">
              {stats.heroPct}
              <span className="text-[1.4rem] text-neutral-strong">%</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? t("collapse") : t("expand")}
            className="-mr-1 -mt-1 shrink-0 rounded-[4px] p-1.5 text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink md:hidden"
          >
            <ChevronDown
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              className={[
                "transition-transform",
                open ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
        </div>
        <div className={bodyClass}>
          <p className="mt-1.5 font-display text-[0.95rem] leading-snug text-ink">
            {t("heroStat", { pct: stats.heroPct })}
          </p>
          <p className="mt-1 text-[11px] text-neutral-strong">
            {t("heroDemoNote")}
          </p>
        </div>
      </header>

      <dl className={`${open ? "grid" : "hidden md:grid"} grid-cols-3 gap-2 border-y border-border py-3`}>
        {figures.map((f) => (
          <div key={f.key} className="flex flex-col gap-0.5">
            <dt className="sr-only">{f.label}</dt>
            <dd className="font-mono text-[1.1rem] font-medium leading-none text-ink">
              {f.value}
            </dd>
            <span
              aria-hidden="true"
              className="text-[10.5px] leading-tight text-neutral-strong"
            >
              {f.label}
            </span>
          </div>
        ))}
      </dl>

      <LayerSwitcher active={activeLayer} onSelect={onSelectLayer} />

      <div className={bodyClass}>
        <Legend
          layer={activeLayer}
          communitySegments={stats.communitySegments}
        />
      </div>
    </section>
  );
}
