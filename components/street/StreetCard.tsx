import { getTranslations } from "next-intl/server";
import { LAYER_ORDER } from "@/components/mapConfig";
import { meterWidth, rampInkVars } from "@/components/scoreColor";
import panel from "@/components/ui/panel.module.css";
import FieldNote from "@/components/FieldNote";
import StreetShareActions from "@/components/street/StreetShareActions";
import { groupFieldObservationsByLayer } from "@/lib/field-notes";
import StreetCardMap from "@/components/street/StreetCardMap";
import type { StreetCardData, StreetProvenanceKind } from "@/lib/street-card";
import type { ScoreLayer } from "@/lib/segments";

function inkStyle(layer: ScoreLayer, value: number): React.CSSProperties {
  return rampInkVars(layer, value) as React.CSSProperties;
}

function Meter({ value }: Readonly<{ value: number }>) {
  return (
    <div className={`mt-1.5 ${panel.meterTrack}`} aria-hidden="true">
      <span className={panel.meterFill} style={{ width: meterWidth(value) }} />
    </div>
  );
}

function provenanceLabel(
  kind: StreetProvenanceKind,
  t: Awaited<ReturnType<typeof getTranslations<"street">>>,
): string {
  if (kind === "audited") return t("provenance.audited");
  if (kind === "camera") return t("provenance.camera");
  return t("provenance.community");
}

type StreetCardProps = Readonly<{
  card: StreetCardData;
}>;

export default async function StreetCard({ card }: StreetCardProps) {
  const t = await getTranslations("street");
  // Grouped by lens, in the map's canonical layer order. The page has room the
  // popover does not, so it shows all five lenses at once rather than only the
  // one a map click happened to be on.
  const observationGroups = groupFieldObservationsByLayer(card.observations);
  const noteLabel = card.auditor
    ? `${t("fieldNoteLabel")} · ${card.auditor}`
    : t("fieldNoteLabel");

  return (
    <article className={`mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10 ${panel.panelScope}`}>
      <header className="border-b border-border pb-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          {t("eyebrow")}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[clamp(1.5rem,3vw,2rem)] font-bold leading-tight tracking-[-0.02em] text-ink-display">
              {card.name}
            </h1>
            <p className="mt-1 text-[14px] text-neutral-strong">{card.district}</p>
          </div>
          <StreetShareActions segmentId={card.id} variant="page" />
        </div>
        {card.demo ? (
          <p className="mt-3 rounded-[6px] border border-dashed border-border-strong bg-surface-sunken px-3 py-2 text-[12px] leading-snug text-neutral-strong">
            {t("demoNote")}
          </p>
        ) : null}
      </header>

      <section className="mt-6">
        <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("scoresHeading")}
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LAYER_ORDER.map((layer) => (
            <li
              key={layer}
              style={inkStyle(layer, card.scores[layer])}
              className="rounded-[8px] border border-border bg-surface-elevated px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] text-ink">{t(`layers.${layer}`)}</span>
                <span className={`font-mono text-[14px] font-semibold ${panel.scoreInk}`}>
                  {card.scores[layer]}
                </span>
              </div>
              <Meter value={card.scores[layer]} />
            </li>
          ))}
        </ul>
      </section>

      {/* The answers behind the five numbers above, with the crew's prose on
          the ones they wrote about. Sits directly under the scores on purpose:
          a note is the reason for a score, and a reader should not have to
          scroll past the provenance and the assessment to find out why a
          street reads badly. */}
      {observationGroups.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t("observationsHeading")}
          </h2>
          <p className="mb-3 text-[12.5px] leading-snug text-neutral-strong">
            {t("observationsNote")}
          </p>
          <div className="space-y-4">
            {observationGroups.map((group) => (
              <div key={group.layer}>
                <h3 className="mb-1.5 text-[12px] font-medium text-ink">
                  {t(`layers.${group.layer}`)}
                </h3>
                <ul className="flex flex-col divide-y divide-border rounded-[8px] border border-border">
                  {group.observations.map((o) => (
                    <li
                      key={o.item_key}
                      style={inkStyle(group.layer, o.score)}
                      className="px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-ink">{o.label}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span aria-hidden="true" className={`${panel.meterTrack} w-14`}>
                            <span
                              className={panel.meterFill}
                              style={{ width: meterWidth(o.score) }}
                            />
                          </span>
                          <span
                            className={`font-mono text-[13px] font-semibold ${panel.scoreInk}`}
                          >
                            {o.score}
                            <span className="font-medium text-neutral-strong">/100</span>
                          </span>
                        </span>
                      </div>
                      <FieldNote label={noteLabel} note={o.note} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {card.provenance.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t("provenanceHeading")}
          </h2>
          <ul className="space-y-2">
            {card.provenance.map((line) => (
              <li
                key={`${line.kind}-${line.primary}`}
                className="rounded-[8px] border border-border bg-surface-sunken px-3 py-2.5"
              >
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-neutral-strong">
                  {provenanceLabel(line.kind, t)}
                </p>
                <p className="mt-0.5 text-[13px] text-ink">{line.primary}</p>
                {line.secondary ? (
                  <p className="mt-0.5 text-[12px] text-neutral-strong">
                    {t("provenance.updated")} {line.secondary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {card.assessment ? (
        <section className="mt-6">
          <h2 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t("assessmentHeading")}
          </h2>
          <div
            className={`rounded-[8px] border border-border bg-surface-sunken px-3 py-3 ${panel.assessment}`}
          >
            <p className="text-[13.5px] leading-relaxed text-ink">{card.assessment}</p>
            <p className="mt-2 text-[11px] leading-snug text-neutral-strong">{t("assessmentNote")}</p>
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("mapHeading")}
        </h2>
        <div className="overflow-hidden rounded-[8px] border border-hairline bg-paper-sunken">
          <div className="h-[220px] sm:h-[280px]">
            <StreetCardMap geometry={card.geometry} overallScore={card.scores.overall} />
          </div>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">{t("mapHint")}</p>
      </section>
    </article>
  );
}
