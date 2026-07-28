/**
 * A field note: the audit crew's prose on the rubric answer directly above it.
 *
 * Deliberately small and hookless. It takes the label already composed by its
 * caller (which owns the translation), so the map panel and the street page
 * render notes in exactly one voice, and so scripts/test-field-notes.mjs can
 * render it for real rather than scanning source for a class name.
 *
 * Three rules are carried here rather than at each call site:
 *
 *  1. NO NOTE, NO CONTAINER. Roughly three of every four observations have
 *     nothing written on them, so an empty affordance would be the common case
 *     and the breakdown would be mostly holes. Returning null is what keeps the
 *     list tight for the 75% and lets the 25% earn its space.
 *  2. QUIETER THAN THE ANSWER. Smaller, muted ink, set behind a hairline rule
 *     rather than in a box: prose from the field is testimony about the number
 *     beside it, not a second heading competing with it.
 *  3. NOT A HUMAN BYLINE. No quotation marks and no personal name. The dataset
 *     is simulated, so the note is attributed to a crew label and nothing about
 *     the framing may suggest a real person said this sentence.
 */
export default function FieldNote({
  label,
  note,
}: Readonly<{ label: string; note: string | null }>) {
  if (!note) return null;
  return (
    <div className="mt-1.5 border-l border-border pl-2.5">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-neutral-strong">
        {label}
      </p>
      <p className="mt-0.5 text-[12px] italic leading-snug text-neutral-strong">
        {note}
      </p>
    </div>
  );
}
