"use client";

import { useLayoutEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ScoreLayer, StreetStats } from "@/lib/segments";
import { showDemoData } from "@/lib/demo-flag";
import {
  defaultMapPanelCollapsed,
  readMapPanelCollapsed,
  writeMapPanelCollapsed,
} from "@/lib/map-panel-storage";
import ExploreCta from "@/components/ExploreCta";
import LayerSwitcher from "@/components/LayerSwitcher";
import Legend from "@/components/Legend";
import ProvenanceNote from "@/components/ProvenanceNote";
import styles from "@/components/ui/zen.module.css";
import panelStyles from "@/components/ui/map-panel.module.css";

/**
 * Floating primary map panel (the only 12px-radius surface, top elevation).
 * Holds the layer switcher, the legend, one live hero stat, and the mono
 * coverage figures. Data density is a feature.
 *
 * Collapsible on every viewport: the chevron hides the stats grid + legend while
 * keeping the headline %, provenance lines, and layer switcher visible (the
 * phone provenance-visibility contract). Collapsed state is remembered for the
 * visit via sessionStorage.
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
  const [expanded, setExpanded] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useLayoutEffect(() => {
    const stored = readMapPanelCollapsed();
    // Hydrate visit-scoped collapse from sessionStorage after SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage read on mount
    setExpanded(stored === null ? !defaultMapPanelCollapsed() : !stored);
    setHydrated(true);
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      writeMapPanelCollapsed(!next);
      return next;
    });
  };

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
      data-map-panel
      data-panel-hydrated={hydrated ? "true" : "false"}
      aria-label={t("eyebrow")}
      className={`${styles.glassPanel} ${styles.enter} pointer-events-auto flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-4 rounded-[12px] p-4`}
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
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls="map-panel-collapsible"
            aria-label={expanded ? t("collapse") : t("expand")}
            className="-mr-1 -mt-1 shrink-0 rounded-[4px] p-1.5 text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <ChevronDown
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              data-expanded={expanded ? "true" : "false"}
              className={panelStyles.chevron}
            />
          </button>
        </div>
        <div
          id="map-panel-collapsible"
          data-expanded={expanded ? "true" : "false"}
          className={panelStyles.collapsible}
        >
          <div className={panelStyles.collapsibleInner}>
            <p className="mt-1.5 font-display text-[0.95rem] leading-snug text-ink">
              {t("heroStat", { pct: stats.heroPct })}
            </p>
            {showDemoData() && (
              <p className="mt-1 text-[11px] text-neutral-strong">
                {t("heroDemoNote")}
              </p>
            )}
          </div>
        </div>
      </header>

      <div
        data-expanded={expanded ? "true" : "false"}
        className={panelStyles.collapsible}
      >
        <div className={panelStyles.collapsibleInner}>
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
        </div>
      </div>

      {/* Outside the collapsible block on purpose: when the audited figures are
          zero these counters are the only live data on the map, and burying them
          behind the chevron is how "still 0%" read as breakage. */}
      <ProvenanceNote stats={stats} tone="panel" className="-mt-1" />

      <LayerSwitcher active={activeLayer} onSelect={onSelectLayer} />

      <div
        data-expanded={expanded ? "true" : "false"}
        className={panelStyles.collapsible}
      >
        <div className={panelStyles.collapsibleInner}>
          <Legend
            layer={activeLayer}
            communitySegments={stats.communitySegments}
          />
        </div>
      </div>

      {/* Outside the collapsible blocks on purpose: collapsing is how a visitor
          asks for more map, and the invitation out of the map is exactly what a
          visitor who never expands the panel would otherwise never see. */}
      <ExploreCta />
    </section>
  );
}
