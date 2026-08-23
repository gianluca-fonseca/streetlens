"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, X } from "lucide-react";
import type { SchoolProperties } from "@/lib/schools";
import type { SchoolZoneWire } from "@/lib/school-map";
import styles from "@/components/ui/zen.module.css";

/**
 * The card behind a school pin.
 *
 * It is deliberately a REGISTRY card, not a score card: nothing here is measured
 * by StreetLens. What a partner needs from a pin is the identity of the site
 * (the MEP code is the join key against their own spreadsheets), where the
 * position came from, and which registry rows run there. The street scores
 * around the school are read off the network under the pin, which is why this
 * card stays small and leaves the map visible.
 *
 * Provenance is on the card rather than in a footnote. `position_delta_m` is the
 * distance between the MEP's surveyed point and the OSM campus centroid, and a
 * large one is the honest way to say "field-check this pin before you quote it".
 */
export default function SchoolDetail({
  school,
  zone,
  onClose,
}: Readonly<{
  school: SchoolProperties;
  /** The zone reading, when the school has one. Absent means no walkshed was
   *  computed for it, which is a build state, not a score. */
  zone?: SchoolZoneWire | null;
  onClose: () => void;
}>) {
  const t = useTranslations("schools");
  const dialogRef = useRef<HTMLElement>(null);

  // Same dismissal contract as SegmentDetail: Escape closes, and the card takes
  // focus when it opens so a keyboard reader is put inside the thing that just
  // appeared rather than left behind on the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const hosted = school.programmes.filter((p) => p.code !== school.mep_code);
  const rows: { label: string; value: string }[] = [];
  if (school.district) rows.push({ label: t("district"), value: titled(school.district) });
  if (school.locality) rows.push({ label: t("locality"), value: titled(school.locality) });
  if (school.mep_code) rows.push({ label: t("mepCode"), value: school.mep_code });
  if (school.mep_circuit) {
    rows.push({ label: t("circuit"), value: titled(school.mep_circuit) });
  }

  return (
    <section
      ref={dialogRef}
      data-school-detail
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={school.display_name}
      className={`${styles.glassPanel} ${styles.enter} pointer-events-auto flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-[12px] p-4`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t(`sector.${school.sector}`)}
            {school.level ? ` · ${t(`level.${school.level}`)}` : ""}
          </p>
          <h2 className="font-display text-[1.05rem] leading-tight text-ink">
            {school.display_name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="-mr-1 -mt-1 flex shrink-0 items-center justify-center rounded-[4px] p-1.5 text-neutral-strong transition-colors pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {zone ? <ZoneReading zone={zone} /> : null}

      {rows.length > 0 && (
        <dl className="flex flex-col gap-1 border-y border-border py-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[11px] text-neutral-strong">{r.label}</dt>
              <dd className="truncate font-mono text-[11.5px] text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Hosted programmes: the CINDEA / CONED / jardín de niños rows that share
          this address. They are why the pin count is lower than the row count. */}
      {hosted.length > 0 && (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-strong">
            {t("alsoHere")}
          </p>
          <ul className="flex flex-col gap-0.5">
            {hosted.map((p) => (
              <li key={p.code} className="text-[12px] leading-snug text-ink">
                {p.display_name}
                <span className="ml-1.5 font-mono text-[10.5px] text-neutral-strong">
                  {p.code}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-border pt-2 text-[11px] leading-snug text-neutral-strong">
        {school.registry === "osm"
          ? t("provenanceOsmOnly")
          : school.position_source === "osm"
            ? t("provenanceMepOsm", { delta: school.position_delta_m ?? 0 })
            : t("provenanceMepOnly")}
      </p>

      {school.website && (
        <a
          href={school.website}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 font-mono text-[11px] text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          {t("website")}
        </a>
      )}
    </section>
  );
}

/**
 * The zone reading: the seal tier, the legal compliance bar, and the diagnostic
 * score, in that order.
 *
 * The order is the argument. A tier is what a parent or a partner acts on; the
 * compliance share is what makes the tier defensible ("this much of the walk is
 * legal" beats "we scored it 54"); and the 0–100 is the engineering handle that
 * says what to fix. Leading with the number would invert that.
 *
 * A school with too little coverage shows the missing metres instead of a
 * grey score. An empty state that says "we have not looked yet, here is how
 * much is left" is useful; one that says "—" is just a hole.
 */
function ZoneReading({ zone }: Readonly<{ zone: SchoolZoneWire }>) {
  const t = useTranslations("schools");
  const pct = (v: number) => `${Math.round(100 * v)}%`;
  const scored = typeof zone.score === "number" && zone.compliance !== null;

  return (
    <section className="flex flex-col gap-2.5 border-y border-border py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("sealLabel")}
        </p>
        <span
          data-tier={zone.tier}
          className="rounded-[4px] border border-border-strong bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink"
        >
          {t(`tier.${zone.tier}`)}
        </span>
      </div>

      {scored ? (
        <>
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] text-neutral-strong">{t("complianceLabel")}</span>
              <span className="font-mono text-[12px] font-medium text-ink">
                {pct(zone.compliance!)}
              </span>
            </div>
            {/* A plain proportional bar, not a gauge: the quantity is a share of
                a walk, and a share reads as a length. */}
            <div className="h-[6px] w-full overflow-hidden rounded-[3px] bg-surface-sunken">
              <span
                className="block h-full rounded-[3px] bg-accent"
                style={{ width: `${Math.round(100 * zone.compliance!)}%` }}
              />
            </div>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] text-neutral-strong">{t("scoreLabel")}</span>
            <span className="font-mono text-[1.05rem] font-medium leading-none text-ink">
              {zone.score}
              <span className="text-[11px] text-neutral-strong">/100</span>
            </span>
          </div>
        </>
      ) : (
        <p className="font-mono text-[11.5px] leading-relaxed text-neutral-strong">
          {t("awaitingData", { pct: pct(zone.coverage) })}
        </p>
      )}

      {/* The capture backlog. Present whether or not the school is scored,
          because it is what changes the answer either way. */}
      {zone.gap_ids.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 border-t border-border pt-2 text-[11px] leading-snug text-neutral-strong">
          <span className="inline-block h-[3px] w-4 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          {t("gapNote", {
            count: zone.gap_ids.length,
            metres: Math.round(zone.gap_length_m),
          })}
        </p>
      )}
    </section>
  );
}

/** The register files districts and circuits in caps; the card reads them out. */
function titled(raw: string): string {
  return raw
    .toLocaleLowerCase("es")
    .replace(/(^|\s|\/)([a-záéíóúñ])/g, (_, pre, ch) => pre + ch.toLocaleUpperCase("es"));
}
