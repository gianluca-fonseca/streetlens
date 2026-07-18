"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { SegmentCollection, StreetStats } from "@/lib/segments";
import { showDemoData } from "@/lib/demo-flag";
import { Link, useRouter } from "@/i18n/navigation";
import { BINS, sampleRamp } from "@/components/mapConfig";
import AuditMap from "@/components/AuditMap";
import Logo from "@/components/ui/Logo";
import ProvenanceNote from "@/components/ProvenanceNote";
import StatFigure from "@/components/ui/StatFigure";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { cn } from "@/components/ui/cn";
import { AUTHOR_LINKEDIN, CITY_REQUEST_URL, CUSP_URL, GITHUB_URL } from "@/lib/links";

/**
 * The platform hero (rev 6, u21 — the mcbroken restructure). A slim top banner
 * over a three-zone utility layout, map dominant: a LEFT rail (compact logo, a
 * short question-title, and a scrolling list of the lowest-scoring streets), the
 * CENTER live audit map (the same u17 cooperative-gesture embed, now nearly
 * full-height), and a RIGHT stack of zen-solid stat cards. Every deeper action
 * opens the full platform at `/[locale]/map`; the manifesto document survives
 * below the fold. The rev-5 masthead voice (thesis H1 + serif abstract) has
 * moved entirely into that document.
 */

/** Slim full-width top banner (mcbroken register): one centered utility line
 * carrying the method anchor and the primary platform link. Black ground / paper
 * text in light; a near-black plate with a hairline separator in dark. Links are
 * paper text with the single sanctioned pink signal on the underline. In flow,
 * not fixed. */
function Banner() {
  const t = useTranslations("landing.hero.banner");
  return (
    <div className="w-full border-b border-transparent bg-ink-display text-paper dark:border-hairline dark:bg-paper-white dark:text-ink">
      <div className="mx-auto flex max-w-[1400px] items-center gap-x-4 px-[max(1rem,env(safe-area-inset-left))] py-2.5 text-[13px] leading-snug sm:px-6">
        <span className="flex flex-1 flex-wrap items-center justify-center gap-x-5 gap-y-1 text-center">
          <span className="inline-flex items-center gap-1.5">
            {t("methodQuestion")}
            <a
              href="#method"
              className="inline-flex items-center pointer-coarse:min-h-[44px] font-medium underline decoration-accent decoration-2 underline-offset-[5px] transition-colors hover:decoration-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper dark:focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink-display dark:focus-visible:ring-offset-paper-white"
            >
              {t("methodLink")}
            </a>
          </span>
          <span aria-hidden="true" className="hidden text-ink-faint sm:inline">
            ·
          </span>
          <Link
            href="/map"
            className="inline-flex items-center gap-1 pointer-coarse:min-h-[44px] font-medium underline decoration-accent decoration-2 underline-offset-[5px] transition-colors hover:decoration-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper dark:focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-ink-display dark:focus-visible:ring-offset-paper-white"
          >
            {t("platform")}
            <span aria-hidden="true">→</span>
          </Link>
        </span>
        <ThemeSwitcher className="shrink-0" />
      </div>
    </div>
  );
}

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
        className="sl-glass-chip inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 pointer-coarse:min-h-[44px] font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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

/** One street in the LEFT-zone list: a hairline card in the segment's SEALED ramp
 * color (a score dot, data context like the legend), the street name, its
 * district, and the mono score. Tapping opens the full platform (u17 rule: no
 * deep-link infra, the map opens at the district view). */
function SegmentRow({
  name,
  district,
  score,
  activateLabel,
  onActivate,
}: Readonly<{
  name: string;
  district: string;
  score: number;
  activateLabel: string;
  onActivate: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={activateLabel}
      className="sl-card flex min-h-[44px] w-full items-center gap-3 rounded-[8px] border border-hairline bg-paper-white px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: sampleRamp("overall", score) }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">
          {name}
        </span>
        <span className="block truncate text-[11.5px] leading-tight text-ink-muted">
          {district}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink-muted">
        {score}
      </span>
    </button>
  );
}

/** A zen-solid stat card in the RIGHT stack (flat ground → hairline + zen-soft
 * shadow, never glass). Mono tabular numerals over one muted explainer line;
 * demo caveating is carried once by the shared footnote at the stack's foot. */
function StatCard({
  value,
  unit,
  label,
  tone = "ink",
  delay,
}: Readonly<{
  value: string;
  unit?: string;
  label: string;
  tone?: "ink" | "accent";
  delay: number;
}>) {
  return (
    <div
      className="sl-card sl-hero-el min-w-[11.5rem] shrink-0 snap-start rounded-[4px] border border-hairline bg-paper-white p-3.5 lg:min-w-0 lg:shrink"
      style={{ animationDelay: `${delay}ms` }}
    >
      <StatFigure value={value} unit={unit} label={label} tone={tone} size="md" />
    </div>
  );
}

/** The official GitHub mark (octocat silhouette), drawn in `currentColor` so it
 * inherits the pill's ink-muted → ink hover. Founder-sanctioned exception to the
 * icon ban, scoped to the open-source pill. */
function GitHubMark({ size = 14 }: Readonly<{ size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** The official LinkedIn "in" mark, drawn in `currentColor` so it takes the bold
 * `--ink` tone of the author name it sits beside. Founder-sanctioned exception to
 * the icon ban, scoped to the author pill only. */
function LinkedInMark({
  size = 13,
  className,
}: Readonly<{ size?: number; className?: string }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 448 512"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.3 0 79.7 44.3 79.7 101.9V416z" />
    </svg>
  );
}

/** Shared pill chrome (zen instrument register): hairline pill on paper-white, T1
 * rest shadow + reduced-motion-safe hover lift via `sl-card`, ink-muted → ink text.
 * Never pink-filled — warmth comes only from the founder-mandated ❤️. */
const PILL_CLASS =
  "sl-card inline-flex min-h-[32px] pointer-coarse:min-h-[44px] items-center gap-2 rounded-full border border-hairline bg-paper-white text-[11.5px] font-medium text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/** The author + open-source pill pair. Replaces u22's plain mono "Open source →
 * GitHub" hero line. The avatar is served locally (never the expiring licdn URL).
 * The author name is bold `--ink` with the LinkedIn mark beside it; on hover the
 * pink underline signal appears under the name, the muted text warms to `--ink`,
 * and the avatar lifts a hair (motion-safe only). The open-source pill carries the
 * same hover family. The shared `sl-card` chrome supplies the zen T1→T2 lift and
 * collapses it to colour-only under `prefers-reduced-motion`. */
function AttributionPills() {
  const t = useTranslations("landing.hero");
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
      <a
        href={AUTHOR_LINKEDIN}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(PILL_CLASS, "group py-1 pl-1 pr-3")}
      >
        <Image
          src="/gianluca.jpg"
          alt=""
          width={44}
          height={44}
          className="h-6 w-6 shrink-0 rounded-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-105"
        />
        <span className="inline-flex items-center gap-1.5">
          {t.rich("madeBy", {
            name: (chunks) => (
              <span className="font-semibold text-ink underline-offset-[3px] group-hover:underline group-hover:decoration-accent group-hover:decoration-2">
                {chunks}
              </span>
            ),
          })}
          <LinkedInMark className="text-ink" />
        </span>
      </a>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(PILL_CLASS, "group px-3 py-1")}
      >
        <GitHubMark />
        <span className="underline-offset-[3px] group-hover:underline group-hover:decoration-accent group-hover:decoration-2">
          {t("openSource")}
        </span>
      </a>
    </div>
  );
}

/** Whether a feature is an official audited segment (community/import adds carry a
 * `source` and no rubric score — they must never enter the score list). */
function isAudited(source: string | undefined, score: number): boolean {
  return score > 0 && (source === undefined || source === "audit");
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

  // The lowest-scoring streets, deduped by name (the worst segment per street, so
  // the list reads as distinct streets rather than seven "Diagonal 68" rows), and
  // the real average bike-infrastructure score — both from the sealed demo data.
  const { worst, avgBike } = useMemo(() => {
    const audited = segments.features.filter((f) =>
      isAudited(f.properties.source, f.properties.score_overall),
    );
    const byStreet = new Map<
      string,
      { name: string; district: string; score: number }
    >();
    for (const f of audited) {
      const p = f.properties;
      const prev = byStreet.get(p.name);
      if (!prev || p.score_overall < prev.score) {
        byStreet.set(p.name, {
          name: p.name,
          district: p.district,
          score: p.score_overall,
        });
      }
    }
    const worstStreets = [...byStreet.values()]
      .sort((a, b) => a.score - b.score)
      .slice(0, 10);
    const bikeMean = audited.length
      ? Math.round(
          audited.reduce((s, f) => s + f.properties.score_bike, 0) /
            audited.length,
        )
      : 0;
    return { worst: worstStreets, avgBike: bikeMean };
  }, [segments]);

  const openPlatform = () => router.push("/map");

  return (
    <section className="pb-10 sm:pb-14 lg:pb-16">
      <Banner />
      <div className="mx-auto w-full pl-[max(clamp(1rem,3vw,4rem),env(safe-area-inset-left))] pr-[max(clamp(1rem,3vw,4rem),env(safe-area-inset-right))] pt-6 sm:pt-8">
        <div className="grid grid-cols-1 gap-x-[clamp(1.25rem,2.2vw,2.5rem)] gap-y-8 lg:h-[78vh] lg:max-h-[52rem] lg:grid-cols-[clamp(280px,20vw,360px)_minmax(0,1fr)_clamp(220px,17vw,320px)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-y-6">
          {/* ── LEFT zone head: lockup, pilot status, question, request +
               attribution pills ──────────────────────────────────────── */}
          <div className="flex flex-col items-center lg:col-start-1 lg:row-start-1 lg:block">
            <div
              className="sl-hero-el flex flex-col items-center text-ink-display lg:items-start"
              style={{ animationDelay: "120ms" }}
            >
              <Logo withWordmark size={20} title={t("wordmark")} />
              {/* Founder byline: the wordmark sits over a quiet "by CUSP" credit,
                  indented to the wordmark's left edge (mark 20 + gap 6.4). Pink
                  underline is the sanctioned link signal, on hover only. */}
              <a
                href={CUSP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-0.5 ml-0 inline-flex items-center font-mono text-[11px] font-medium text-ink-muted underline-offset-[3px] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface lg:ml-[26.4px]"
              >
                <span className="group-hover:underline group-hover:decoration-accent group-hover:decoration-2">
                  {t("byCusp")}
                </span>
              </a>
            </div>
            <p
              className="sl-hero-el mt-4 inline-flex items-center rounded-[2px] border border-hairline bg-paper-white px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-ink-muted"
              style={{ animationDelay: "160ms" }}
            >
              {t("pilot")}
            </p>
            <h1
              className="sl-hero-el mt-3 max-w-[20ch] text-center font-display text-[clamp(1.35rem,1.9vw,1.6rem)] font-bold leading-[1.12] tracking-[-0.02em] text-ink-display text-balance lg:text-left dark:tracking-[-0.015em]"
              style={{ animationDelay: "200ms" }}
            >
              {t("question")}
            </h1>
            <p
              className="sl-hero-el mt-2 max-w-[38ch] text-center text-[12.5px] leading-[1.45] text-ink-muted text-pretty lg:text-left"
              style={{ animationDelay: "220ms" }}
            >
              {t("subtitle")}
            </p>
            <a
              href={CITY_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="sl-hero-el mt-3 inline-flex min-h-[24px] pointer-coarse:min-h-[44px] items-center gap-1 text-[12.5px] text-ink-muted underline decoration-accent decoration-2 underline-offset-[4px] transition-colors hover:text-ink-display hover:decoration-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              style={{ animationDelay: "240ms" }}
            >
              {t("requestCity")}
              <span aria-hidden="true">→</span>
            </a>
            <div className="sl-hero-el mt-4" style={{ animationDelay: "300ms" }}>
              <AttributionPills />
            </div>
          </div>

          {/* ── CENTER zone: the live map plate (z0 frame) + chips (z10) ── */}
          <div className="sl-hero-map flex min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-full">
            <div className="min-h-0 flex-1 rounded-[4px] border border-hairline bg-paper p-2 sm:p-3">
              <div
                data-map-moving={mapMoving ? "true" : "false"}
                className="relative h-[55dvh] overflow-hidden rounded-[2px] bg-paper-sunken lg:h-full"
              >
                <AuditMap
                  variant="hero"
                  interactive
                  segments={segments}
                  onSegmentActivate={openPlatform}
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

          {/* ── RIGHT zone: zen-solid stat stack (horizontal snap on phone,
               vertical on desktop) + one shared demo footnote ────────── */}
          <div className="flex flex-col gap-3 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:min-w-0">
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:px-0 lg:pb-0 lg:[scrollbar-width:thin]">
              <StatCard
                value={String(stats.heroPct)}
                unit="%"
                label={t("stats.failLabel")}
                tone="accent"
                delay={420}
              />
              <StatCard
                value={String(stats.coveragePct)}
                unit="%"
                label={t("stats.coverageLabel")}
                delay={490}
              />
              <StatCard
                value={String(stats.segments)}
                label={t("stats.segmentsLabel")}
                delay={560}
              />
              <StatCard
                value={stats.km.toFixed(1)}
                unit="km"
                label={t("stats.kmLabel")}
                delay={630}
              />
              <StatCard
                value={String(avgBike)}
                unit="/100"
                label={t("stats.bikeLabel")}
                delay={700}
              />
            </div>
            {/* The unaudited signal, beside (never inside) the audited cards:
                a camera pass and a community add are real work, and with no
                published audit they are the only live numbers on the page. */}
            <ProvenanceNote stats={stats} align="center" className="px-1 lg:px-0" />
            {showDemoData() && (
              <p className="px-1 text-center font-mono text-[11px] leading-snug text-ink-muted lg:px-0 lg:text-left">
                {t("stats.demoFootnote")}
              </p>
            )}
          </div>

          {/* ── LEFT zone body: the scrolling worst-streets list ──────── */}
          <div className="flex flex-col lg:col-start-1 lg:row-start-2 lg:min-h-0">
            <div className="shrink-0 text-center lg:text-left">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                {t("segments.title")}
              </p>
              {showDemoData() && (
                <p className="mt-1 font-mono text-[11px] leading-snug text-ink-muted">
                  {t("segments.caveat")}
                </p>
              )}
            </div>
            <ul className="mt-3 space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:thin]">
              {worst.map((s) => (
                <li key={s.name}>
                  <SegmentRow
                    name={s.name}
                    district={s.district}
                    score={s.score}
                    activateLabel={t("segments.activate", { name: s.name })}
                    onActivate={openPlatform}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
