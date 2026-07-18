"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG engineering plates; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";
import Sidenote from "@/components/ui/Sidenote";
import StatFigure from "@/components/ui/StatFigure";
import Figure from "@/components/ui/Figure";

/**
 * Section 04 — the method. A serif argument with two margin citations (MAPS-Mini,
 * LANAMME-UCR), the four grounding inputs as a hairline rubric grid (not cards),
 * an example segment shown as TABLE 1 (an honest illustrative readout, framed in
 * hairlines, captioned as demo), then the two-way collection engine.
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
    <Section id="method" tone="sunken" rule>
      <Measure width="outset">
        <SectionHeader
          index="05"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="text" className="mt-12">
        <p className="font-serif text-[1.08rem] leading-[1.7] text-ink">
          {t.rich("body", {
            maps: (chunks) => <Sidenote number={3}>{chunks}</Sidenote>,
            lanamme: (chunks) => <Sidenote number={4}>{chunks}</Sidenote>,
          })}
        </p>
      </Measure>

      {/* Four grounding inputs: a hairline rubric, not cards. Unordered by design
          (no 01–04 index), so the grid carries the structure. */}
      <Measure width="page" className="clear-both mt-14">
        <div className="grid gap-px overflow-hidden rounded-[4px] border border-hairline bg-hairline sm:grid-cols-2">
          {METHOD_ITEMS.map((key) => (
            <div key={key} className="bg-surface p-6 sm:p-7">
              <h3 className="font-display text-[1.15rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display">
                {t(`items.${key}.title`)}
              </h3>
              <p className="mt-2 font-serif text-[1rem] leading-[1.55] text-ink-muted">
                {t(`items.${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </Measure>

      {/* Plate 1 as Figure 4: a right-of-way cross-section that shows what the four
          lenses read, matted as a printed sheet (the SVG carries its own paper). */}
      <Measure width="page" className="mt-10">
        <Figure
          id="figure-4"
          label={t("plates.crossSection.label")}
          claim={t("plates.crossSection.claim")}
          support={t("plates.crossSection.support")}
          source={t("plates.crossSection.source")}
          aspectClassName="aspect-[1160/760]"
        >
          <img
            src="/drawings/plate-1-cross-section.svg"
            alt={t("plates.crossSection.alt")}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </Figure>
      </Measure>

      {/* Example-segment anatomy as TABLE 1: hairline-framed, mono readout. */}
      <Measure width="page" className="mt-10">
        <figure className="rounded-[4px] border border-hairline bg-surface p-6 sm:p-8">
          <div className="grid gap-8 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center">
            <div>
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                {t("anatomyLabel")}.
              </span>
              <p className="mt-1.5 font-display text-[1.15rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display">
                {t("anatomySegment")}
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
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-ink-display"
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
          <figcaption className="mt-6 border-t border-hairline pt-4 font-serif text-[0.95rem] leading-snug text-ink-muted">
            {t("anatomyCaption")}
          </figcaption>
        </figure>
      </Measure>

      {/* Plate 2 as Figure 5: the scoring anatomy behind the readout above, matted
          as a printed sheet. Pairs the schematic with Table 1's concrete example. */}
      <Measure width="page" className="mt-10">
        <Figure
          id="figure-5"
          label={t("plates.anatomy.label")}
          claim={t("plates.anatomy.claim")}
          support={t("plates.anatomy.support")}
          source={t("plates.anatomy.source")}
          aspectClassName="aspect-[1160/760]"
        >
          <img
            src="/drawings/plate-2-scoring-anatomy.svg"
            alt={t("plates.anatomy.alt")}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </Figure>
      </Measure>

      {/* The collection engine: two ways in, one reviewed dataset. */}
      <Measure width="outset" className="mt-16">
        <div className="text-center">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("collect.eyebrow")}
          </p>
          <h3 className="mx-auto mt-4 max-w-[24ch] font-display text-[clamp(1.35rem,2.6vw,1.8rem)] font-bold leading-[1.14] tracking-[-0.015em] text-ink-display text-balance">
            {t("collect.heading")}
          </h3>
        </div>
      </Measure>

      <Measure width="page" className="mt-10">
        <div className="grid gap-px overflow-hidden rounded-[4px] border border-hairline bg-hairline sm:grid-cols-2">
          {(["field", "community"] as const).map((key) => (
            <div key={key} className="bg-surface p-6 sm:p-7">
              <h4 className="font-display text-[1.1rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display">
                {t(`collect.${key}.title`)}
              </h4>
              <p className="mt-2 font-serif text-[1rem] leading-[1.55] text-ink-muted">
                {t(`collect.${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </Measure>

      {/* The forward-looking engine: field imagery trains a computer-vision and
          machine-learning scoring pipeline. Roadmap-framed only. No model scores a
          street today; when one does, a person still verifies it (honesty rule). */}
      <Measure width="outset" className="mt-16">
        <div className="text-center">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("pipeline.eyebrow")}
          </p>
          <h3 className="mx-auto mt-4 max-w-[24ch] font-display text-[clamp(1.35rem,2.6vw,1.8rem)] font-bold leading-[1.14] tracking-[-0.015em] text-ink-display text-balance">
            {t("pipeline.heading")}
          </h3>
        </div>
      </Measure>

      <Measure width="text" className="mt-6">
        <p className="font-serif text-[1.08rem] leading-[1.7] text-ink">
          {t("pipeline.body")}
        </p>
      </Measure>

      {/* Plate 3 as Figure 6: the method pipeline. The dashed ML/CV loop IS the
          honesty story, so the caption stays roadmap-framed (not built). */}
      <Measure width="page" className="mt-10">
        <Figure
          id="figure-6"
          label={t("plates.pipeline.label")}
          claim={t("plates.pipeline.claim")}
          support={t("plates.pipeline.support")}
          source={t("plates.pipeline.source")}
          aspectClassName="aspect-[1160/760]"
        >
          <img
            src="/drawings/plate-3-method-pipeline.svg"
            alt={t("plates.pipeline.alt")}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </Figure>
      </Measure>

      <Measure width="outset" className="mt-12">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-hairline pt-6 text-[13px]">
          <Link
            href="/method"
            className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
          >
            {t("fullMethod")}
          </Link>
          <Link
            href="/rubric"
            className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
          >
            {t("fullRubric")}
          </Link>
        </div>
      </Measure>
    </Section>
  );
}
