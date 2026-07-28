"use client";

import { useLayoutEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ScoreLayer, StreetStats } from "@/lib/segments";
import { hideAuditedZeros } from "@/lib/real-data-era";
import { useDemoData } from "@/components/DemoDataProvider";
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
  const demoEnabled = useDemoData();
  // With the demo era off and nothing audited yet, every audited figure reads 0.
  // A 0% hero and a "0 / 0.0 / 0%" row look like breakage, not honesty, so the
  // panel says so in words and lets the live provenance counters carry the panel.
  const auditedHidden = hideAuditedZeros(stats, demoEnabled);
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
      /* The cap reserves the row beneath the aside for the 3D toggle: 3.25rem
         is the column `gap-3` (12px) plus the toggle's 37.5px. On a coarse
         pointer the toggle takes the 44px tap floor, so the reserve becomes
         12 + 44 = 3.5rem. */
      className={`${styles.glassPanel} ${styles.enter} pointer-events-auto flex max-h-[calc(100%-3.25rem)] pointer-coarse:max-h-[calc(100%-3.5rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-4 overflow-y-auto rounded-[12px] p-4 pb-0`}
    >
      <header>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-ink-muted">
              {t("eyebrow")}
            </p>
            {auditedHidden ? null : (
              <p className="font-mono text-[2.15rem] font-medium leading-none tracking-tight text-accent-text">
                {stats.heroPct}
                <span className="text-[1.4rem] text-neutral-strong">%</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls="map-panel-collapsible"
            aria-label={expanded ? t("collapse") : t("expand")}
            // 30x30 measured at 390x844. On a coarse pointer this is the only
            // way to open the aside (it starts collapsed below 768px), so it
            // takes the full 44px floor; the negative margins already pull it
            // into the panel padding, so the header does not grow with it.
            className="-mr-1 -mt-1 flex shrink-0 items-center justify-center rounded-[4px] p-1.5 text-neutral-strong transition-colors pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
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
            {auditedHidden ? (
              <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-neutral-strong">
                {t("auditedEmpty")}
              </p>
            ) : (
              <>
                <p className="mt-1.5 font-display text-[0.95rem] leading-snug text-ink">
                  {t("heroStat", { pct: stats.heroPct })}
                </p>
                {demoEnabled && (
                  <p className="mt-1 text-[11px] text-neutral-strong">
                    {t("heroDemoNote")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Not rendered at all in the real-data era: a hidden-but-present "0"
          would still reach assistive tech as an audited readout. */}
      {auditedHidden ? null : (
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
      )}

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
