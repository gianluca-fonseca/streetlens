"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import Panel from "@/components/ui/Panel";
import StatFigure from "@/components/ui/StatFigure";

/**
 * "How it works": the field method laid out honestly. Four grounding entries
 * read as a typographic rubric (title + descriptor, no icon cards), then an
 * example-segment card shows the segment-detail anatomy as an illustrative
 * scores-by-layer readout, and finally the two-way collection engine. The
 * anatomy figures are static demo values, captioned as such, never a claim.
 */
const METHOD_ITEMS = ["maps", "lanamme", "ley", "field"] as const;

/** Illustrative segment-detail anatomy. Demo numbers over real geometry only. */
const ANATOMY_OVERALL = 73;
const ANATOMY_LAYERS = [
  { key: "accessibility", value: 41 },
  { key: "drainage", value: 68 },
  { key: "shade", value: 55 },
  { key: "bike", value: 30 },
] as const;

export default function MethodSection() {
  const t = useTranslations("landing.method");
  const tl = useTranslations("layers");

  return (
    <Section id="method" tone="bone">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.85rem,3.9vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
          {t("lead")}
        </p>
      </Reveal>

      {/* Four grounding-of-method entries: a hairline-divided rubric, not cards. */}
      <div className="mt-12 grid gap-px overflow-hidden rounded-[8px] border border-border bg-border sm:grid-cols-2">
        {METHOD_ITEMS.map((key, i) => (
          <Reveal
            key={key}
            as="div"
            delay={i * 70}
            className="bg-surface-elevated p-6 sm:p-7"
          >
            <span className="font-mono text-[12px] font-medium text-pine">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2 font-display text-[1.15rem] font-semibold leading-tight text-ink">
              {t(`items.${key}.title`)}
            </h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-neutral-strong">
              {t(`items.${key}.desc`)}
            </p>
          </Reveal>
        ))}
      </div>

      {/* Example-segment anatomy: an honest illustrative readout in mono. */}
      <Reveal delay={80} className="mt-8">
        <Panel radius="primary" elevation="panel" className="p-6 sm:p-7">
          <div className="grid gap-8 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center">
            <div>
              <Eyebrow>{t("items.field.title")}</Eyebrow>
              <p className="mt-1.5 font-display text-[1.15rem] font-semibold leading-tight text-ink">
                Calle Central, San Antonio
              </p>
              <div className="mt-4">
                <StatFigure
                  value={ANATOMY_OVERALL}
                  label={tl("overall.name")}
                  size="lg"
                  tone="ink"
                />
              </div>
            </div>

            <dl className="flex flex-col gap-3">
              {ANATOMY_LAYERS.map((layer) => (
                <div key={layer.key} className="flex items-center gap-4">
                  <dt className="w-28 shrink-0 text-[0.9rem] font-medium text-ink">
                    {tl(`${layer.key}.name`)}
                  </dt>
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-pine"
                      style={{ width: `${layer.value}%` }}
                    />
                  </div>
                  <dd className="w-9 shrink-0 text-right font-mono text-[0.95rem] font-medium text-ink">
                    {layer.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-6 border-t border-border pt-4 text-[12.5px] leading-snug text-neutral-strong">
            {t("anatomyLabel")}
          </p>
        </Panel>
      </Reveal>

      {/* The collection engine: two ways in, one reviewed dataset. */}
      <Reveal delay={40} className="mt-16 max-w-3xl">
        <Eyebrow>{t("collect.eyebrow")}</Eyebrow>
        <h3 className="mt-3 font-display text-[clamp(1.4rem,2.8vw,1.9rem)] font-semibold leading-[1.14] tracking-tight text-ink">
          {t("collect.heading")}
        </h3>
      </Reveal>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {(["field", "community"] as const).map((key, i) => (
          <Reveal key={key} as="div" delay={i * 90}>
            <Panel elevation="panel" className="h-full p-6 sm:p-7">
              <h4 className="font-display text-[1.1rem] font-semibold leading-tight text-ink">
                {t(`collect.${key}.title`)}
              </h4>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-neutral-strong">
                {t(`collect.${key}.desc`)}
              </p>
            </Panel>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
