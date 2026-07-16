"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { SegmentCollection, StreetStats } from "@/lib/segments";
import { useRouter } from "@/i18n/navigation";
import { BINS, sampleRamp } from "@/components/mapConfig";
import AuditMap from "@/components/AuditMap";
import Button from "@/components/ui/Button";
import Eyebrow from "@/components/ui/Eyebrow";
import Logo from "@/components/ui/Logo";
import StatFigure from "@/components/ui/StatFigure";
import { cn } from "@/components/ui/cn";

/**
 * The platform hero (rev 6, u17). The mcbroken pattern in the Zen Instrument
 * key: a live, genuinely usable audit map embedded above the fold, a title rail
 * beside it, zen-solid stat cards below the rail, and glass chips floating on the
 * map. Every deeper action opens the full platform at `/[locale]/map`.
 *
 * Layout (research §4): a left rail (360px at 1440) and a large map plate on the
 * right at desktop; a stacked title-block / map / stat-row on phone. Motion
 * (research §3): the map focuses into place first, then the rail chrome cascades
 * on top, the stat cards stagger 70ms apart, and the LIVE / legend chips land
 * last. All one-shot, reduced-motion collapses it to a plain fade.
 */

/** LIVE presence chip (glass Recipe C). Solid pink dot + calm breathing halo; a
 * static solid dot under reduced motion. No timestamp — the map is live, the demo
 * scores are not, and the honesty rule forbids implying data freshness. */
function LiveChip({ label }: Readonly<{ label: string }>) {
  return (
    <div
      className="sl-hero-el sl-glass-chip pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3.5"
      style={{ animationDelay: "560ms" }}
    >
      <span aria-hidden="true" className="sl-live-dot h-2 w-2 rounded-full" />
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink">
        {label}
      </span>
    </div>
  );
}

/** Compact expandable legend chip (glass Recipe C). Composes the sealed score
 * ramp (BINS + sampleRamp) and the shared `legend` copy, rather than restyling the
 * app's Legend surface (u18-owned). The color swatch is a SOLID sub-element on the
 * glass — never a tint of the glass itself. */
function LegendChip() {
  const t = useTranslations("legend");
  const [open, setOpen] = useState(false);
  return (
    <div
      className="sl-hero-el absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-end"
      style={{ animationDelay: "560ms" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sl-glass-chip inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {t("title")}
        <ChevronDown
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <ul className="sl-glass-chip mt-1.5 flex flex-col gap-1.5 rounded-[10px] p-2.5">
          {BINS.map((bin) => (
            <li key={bin.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-1 w-5 shrink-0 rounded-full"
                style={{ backgroundColor: sampleRamp("overall", bin.mid) }}
              />
              <span className="font-mono text-[11px] text-ink">
                {t(`bins.${bin.key}`)}
              </span>
              <span className="ml-auto pl-3 font-mono text-[10px] tabular-nums text-ink-muted">
                {bin.min}–{bin.max}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A zen-solid stat card in the rail (flat ground → hairline + zen-soft shadow,
 * never glass). Mono tabular numerals; a demo caveat where the number is synthetic. */
function StatCard({
  value,
  unit,
  label,
  note,
  tone = "ink",
  delay,
}: Readonly<{
  value: string;
  unit?: string;
  label: string;
  note: string;
  tone?: "ink" | "accent";
  delay: number;
}>) {
  return (
    <div
      className="sl-card sl-hero-el min-w-[13.5rem] shrink-0 snap-start rounded-[4px] border border-hairline bg-paper-white p-4 lg:min-w-0 lg:shrink"
      style={{ animationDelay: `${delay}ms` }}
    >
      <StatFigure
        value={value}
        unit={unit}
        label={label}
        sublabel={note}
        tone={tone}
        size="md"
      />
    </div>
  );
}

export default function Hero({
  segments,
  stats,
}: Readonly<{
  segments: SegmentCollection;
  stats: StreetStats;
}>) {
  const t = useTranslations("landing.hero");
  const router = useRouter();
  // Drop the over-tile glass chips to solid while the map is moving (research §1
  // perf note): backdrop-blur re-blurs every frame a map pans/zooms.
  const [mapMoving, setMapMoving] = useState(false);

  return (
    <section className="pb-10 pt-[max(2.5rem,calc(env(safe-area-inset-top)+1.5rem))] sm:pb-14 lg:pb-16">
      <div className="mx-auto w-full max-w-[1400px] px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 lg:px-8">
        <div className="grid gap-x-8 gap-y-6 lg:min-h-[87vh] lg:grid-cols-[360px_1fr] lg:grid-rows-[1fr_auto_auto_1fr]">
          {/* ── Title block (rail head). Centered as a group with the stat
               cards inside the hero zone via the two 1fr spacer rows. ─── */}
          <div className="lg:col-start-1 lg:row-start-2">
            <div
              className="sl-hero-el text-ink-display"
              style={{ animationDelay: "120ms" }}
            >
              <Logo withWordmark size={22} title={t("wordmark")} />
            </div>
            <div
              className="sl-hero-el mt-4"
              style={{ animationDelay: "120ms" }}
            >
              <Eyebrow>{t("eyebrow")}</Eyebrow>
            </div>
            <h1
              className="sl-hero-el mt-3 max-w-[16ch] font-display text-[clamp(1.85rem,3vw,2.6rem)] font-bold leading-[1.05] tracking-[-0.025em] text-ink-display text-balance dark:tracking-[-0.02em]"
              style={{ animationDelay: "180ms" }}
            >
              {t("thesis")}
            </h1>
            <p
              className="sl-hero-el mt-4 max-w-[34rem] font-serif text-[1.05rem] leading-[1.5] text-ink text-pretty"
              style={{ animationDelay: "260ms" }}
            >
              {t("abstract")}
            </p>
            <div
              className="sl-hero-el mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
              style={{ animationDelay: "340ms" }}
            >
              <Button
                href="/map"
                variant="accent"
                size="lg"
                className="min-h-[48px] w-full justify-center sm:w-auto"
              >
                {t("ctaPlatform")}
              </Button>
              <a
                href="#method"
                className="inline-flex min-h-[48px] items-center font-medium text-ink underline decoration-accent decoration-2 underline-offset-[6px] transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {t("ctaMethod")}
              </a>
            </div>
          </div>

          {/* ── Map plate (z0 flat frame) + glass chips (z10) ───────── */}
          <div className="sl-hero-map flex flex-col lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:h-[63dvh] lg:max-h-[44rem] lg:self-center">
            <div className="min-h-0 flex-1 rounded-[4px] border border-hairline bg-paper p-2 sm:p-3">
              <div
                data-map-moving={mapMoving ? "true" : "false"}
                className="relative h-[60dvh] overflow-hidden rounded-[2px] bg-paper-sunken lg:h-full"
              >
                <AuditMap
                  variant="hero"
                  interactive
                  segments={segments}
                  onSegmentActivate={() => router.push("/map")}
                  onMoveStateChange={setMapMoving}
                />
                <LiveChip label={t("map.live")} />
                <LegendChip />
              </div>
            </div>
            <p className="mt-2.5 px-1 font-mono text-[11px] leading-snug text-ink-muted">
              {t("map.affordance")}
            </p>
          </div>

          {/* ── Stat cards (zen-solid): horizontal scroll on phone, stacked
               in the rail on desktop ─────────────────────────────────── */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:col-start-1 lg:row-start-3 lg:mt-2 lg:flex-col lg:self-start lg:overflow-visible lg:px-0 lg:pb-0">
            <StatCard
              value={String(stats.segments)}
              label={t("stats.segmentsLabel")}
              note={t("stats.segmentsNote")}
              delay={420}
            />
            <StatCard
              value={String(stats.coveragePct)}
              unit="%"
              label={t("stats.coverageLabel")}
              note={t("stats.coverageNote")}
              delay={490}
            />
            <StatCard
              value={String(stats.heroPct)}
              unit="%"
              label={t("stats.failLabel")}
              note={t("stats.failNote")}
              tone="accent"
              delay={560}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
