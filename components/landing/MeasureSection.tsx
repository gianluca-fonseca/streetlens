"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 01 — the four lenses. Each lens is a numbered plate (Figure 2a–2d):
 * a real rendered extract of the pilot network scored on that rubric, matted in
 * a hairline frame, with a mono figure label, a bold-black name, a serif
 * descriptor, and the actual low-to-high ramp as a captioned legend. The ramp
 * hexes are the sealed data ramp — data, allowed inside a figure, never chrome.
 */
type Lens = {
  key: "accessibility" | "drainage" | "shade" | "bike";
  fig: string;
  img: string;
  /** The real mapConfig ramp stops at score 0 / 50 / 100 (low to high). */
  stops: [string, string, string];
};

const LENSES: readonly Lens[] = [
  { key: "accessibility", fig: "2a", img: "/render/lens-accessibility.svg", stops: ["#FFE945", "#7C7B78", "#00204D"] },
  { key: "drainage", fig: "2b", img: "/render/lens-drainage.svg", stops: ["#C7C13B", "#4CA377", "#21808C"] },
  { key: "shade", fig: "2c", img: "/render/lens-shade.svg", stops: ["#DDE3CE", "#6E9463", "#14532D"] },
  { key: "bike", fig: "2d", img: "/render/lens-bike.svg", stops: ["#E8D9C4", "#C88C5E", "#8A4B2D"] },
];

export default function MeasureSection() {
  const t = useTranslations("landing.measure");

  return (
    <Section id="measure" tone="paper" rule>
      <Measure width="outset">
        <SectionHeader
          index="01"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="page" className="mt-14 sm:mt-16">
        <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2">
          {LENSES.map((lens) => (
            <figure key={lens.key}>
              <div className="rounded-[4px] border border-hairline bg-paper p-2">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[2px] bg-paper-sunken">
                  <img
                    src={lens.img}
                    alt={t("plateAlt", { name: t(`items.${lens.key}.name`) })}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <figcaption className="mt-4">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                  {t(`items.${lens.key}.fig`)}.
                </span>
                <p className="mt-1.5 font-display text-[1.2rem] font-bold leading-tight tracking-[-0.01em] text-ink-display">
                  {t(`items.${lens.key}.name`)}
                </p>
                <p className="mt-1.5 font-serif text-[1rem] leading-[1.5] text-ink-muted">
                  {t(`items.${lens.key}.desc`)}
                </p>
                <div
                  className="mt-4 h-1.5 w-full rounded-full"
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${lens.stops[0]}, ${lens.stops[1]}, ${lens.stops[2]})`,
                  }}
                  aria-hidden="true"
                />
                <div className="mt-1.5 flex justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-ink-muted">
                  <span>{t(`items.${lens.key}.low`)}</span>
                  <span>{t(`items.${lens.key}.high`)}</span>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Measure>
    </Section>
  );
}
