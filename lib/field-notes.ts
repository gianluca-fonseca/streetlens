/**
 * Field notes — the audit crew's prose on ONE rubric answer.
 *
 * The simulated pilot dataset carries a `note` (Spanish, what a crew would
 * actually write on the street) and a `note_en` sibling on 2,215 of its 8,025
 * observations, mirroring the `label_es` / `label_en` pairing already on every
 * one. A note is evidence for a single item's answer, so this module never
 * detaches the two: it resolves an observation into the viewer's locale and
 * hands back the label, the answer, and the note as one record.
 *
 * Nothing here reads the filesystem or a request, so it is importable from the
 * client panel and from a server component alike. It is also pure, which is what
 * lets scripts/test-field-notes.mjs assert the locale rules against the real
 * data file rather than against a source scan.
 *
 * Honesty: these notes are GENERATED, not transcribed. Presentation is the
 * caller's job, but the rule the callers share is that a note is attributed to a
 * crew label (`Equipo StreetLens A/B/C`, deliberately non-personal) and never
 * quoted as a person speaking.
 */

import type { ObservationDetail, ScoreLayer } from "./types";

/** The locale whose prose lives in `note` / `label_es`. */
const SPANISH = "es";

/** One rubric answer, resolved for display in a single locale. */
export type FieldObservation = {
  item_key: string;
  layer: ScoreLayer;
  /** Rubric item label in the viewer's locale. */
  label: string;
  /** The 0..1 response as a whole 0-100 figure, so it meters like a score. */
  score: number;
  /** The crew's note in the viewer's locale, or null when they wrote none. */
  note: string | null;
};

const LAYERS: ScoreLayer[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
  "bike",
];

function isLayer(value: unknown): value is ScoreLayer {
  return typeof value === "string" && (LAYERS as string[]).includes(value);
}

/** A non-empty trimmed string, or null. Blank prose is the same as no prose. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The note to show, in the viewer's language.
 *
 * Spanish viewers get `note`, English viewers get `note_en`. When the preferred
 * side is missing the other one is shown: a note in the wrong language still
 * explains the score, and a hole in the panel explains nothing. Nothing is
 * translated at runtime, and the two are never shown together.
 */
export function fieldNoteForLocale(
  note: unknown,
  noteEn: unknown,
  locale: string,
): string | null {
  const es = text(note);
  const en = text(noteEn);
  return locale === SPANISH ? (es ?? en) : (en ?? es);
}

/** The rubric item label in the viewer's language, falling back the same way. */
export function rubricLabelForLocale(
  labelEn: unknown,
  labelEs: unknown,
  locale: string,
): string | null {
  const es = text(labelEs);
  const en = text(labelEn);
  return locale === SPANISH ? (es ?? en) : (en ?? es);
}

/** A 0..1 response as a whole 0-100 figure, clamped. Non-numeric reads as 0. */
function toScore(response: unknown): number {
  if (typeof response !== "number" || !Number.isFinite(response)) return 0;
  return Math.max(0, Math.min(100, Math.round(response * 100)));
}

/**
 * Resolve audit observations for one locale, in the order the audit recorded
 * them. An entry with no usable label is dropped rather than rendered as an
 * unlabelled row: a note with nothing to attach to is exactly the detached blob
 * this module exists to avoid.
 *
 * `observations` is deliberately `unknown`: on the map panel it arrives over the
 * wire from /api/segments/[id]/detail, and malformed JSON must degrade to an
 * empty breakdown rather than throw under a panel with no error boundary.
 */
export function toFieldObservations(
  observations: unknown,
  locale: string,
): FieldObservation[] {
  if (!Array.isArray(observations)) return [];
  const out: FieldObservation[] = [];
  for (const raw of observations) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Partial<ObservationDetail> & { note_en?: unknown };
    if (!isLayer(o.layer)) continue;
    const label = rubricLabelForLocale(o.label_en, o.label_es, locale);
    if (label === null) continue;
    const itemKey = text(o.item_key);
    if (itemKey === null) continue;
    out.push({
      item_key: itemKey,
      layer: o.layer,
      label,
      score: toScore(o.response),
      note: fieldNoteForLocale(o.note, o.note_en, locale),
    });
  }
  return out;
}

/** The subset belonging to one lens, in audit order. */
export function fieldObservationsForLayer(
  observations: FieldObservation[],
  layer: ScoreLayer,
): FieldObservation[] {
  return observations.filter((o) => o.layer === layer);
}

/**
 * Group by lens in the map's canonical layer order, dropping lenses the audit
 * said nothing about. Used by the street page, which shows all five at once.
 */
export function groupFieldObservationsByLayer(
  observations: FieldObservation[],
): { layer: ScoreLayer; observations: FieldObservation[] }[] {
  return LAYERS.map((layer) => ({
    layer,
    observations: fieldObservationsForLayer(observations, layer),
  })).filter((group) => group.observations.length > 0);
}

/**
 * The auditing crew's label, or null. A team label (`Equipo StreetLens B`) is
 * the ONLY attribution these notes ever carry: the dataset is simulated, so a
 * personal byline would imply a real person wrote a sentence no one wrote.
 */
export function auditorLabel(value: unknown): string | null {
  return text(value);
}
