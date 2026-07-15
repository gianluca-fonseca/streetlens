"use client";

import { useTranslations } from "next-intl";
import type { ScoreLayer, StreetStats } from "@/lib/segments";
import LayerSwitcher from "@/components/LayerSwitcher";
import Legend from "@/components/Legend";

/**
 * Floating primary map panel (the only 12px-radius surface, top elevation).
 * Holds the layer switcher, the always-visible legend, one live hero stat,
 * and the mono coverage figures. Data density is a feature.
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
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-pine">
          {t("eyebrow")}
        </p>
        <p className="font-mono text-[2.15rem] font-medium leading-none tracking-tight text-terracotta">
          {stats.heroPct}
          <span className="text-[1.4rem] text-neutral-strong">%</span>
        </p>
        <p className="mt-1.5 font-display text-[0.95rem] leading-snug text-ink">
          {t("heroStat", { pct: stats.heroPct })}
        </p>
        <p className="mt-1 text-[11px] text-neutral-strong">
          {t("heroDemoNote")}
        </p>
      </header>

      <dl className="grid grid-cols-3 gap-2 border-y border-border py-3">
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

      <Legend
        layer={activeLayer}
        communitySegments={stats.communitySegments}
      />
    </section>
  );
}
