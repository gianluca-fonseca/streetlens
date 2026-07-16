/**
 * Data-dense stat tiles in the established mono-numeral style. One repeated
 * primitive (not five card styles); optional semantic accent for the
 * submission-status figures (amber pending / clay rejected; approved is neutral
 * ink), never a decorative left-border.
 */
import styles from "@/components/ui/zen.module.css";

export type StatTile = {
  key: string;
  value: string;
  label: string;
  /** Optional secondary line (mono or sans, small). */
  sub?: string;
  /** Optional semantic accent color for the value (status figures). */
  accent?: string;
};

export default function StatTiles({
  tiles,
}: Readonly<{
  tiles: StatTile[];
}>) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div
          key={t.key}
          className={`${styles.plate} flex flex-col gap-1 rounded-[8px] border border-border bg-surface-elevated p-3.5`}
        >
          <dd
            className="font-mono text-[1.55rem] font-medium leading-none tracking-tight text-ink"
            style={t.accent ? { color: t.accent } : undefined}
          >
            {t.value}
          </dd>
          <dt className="text-[11.5px] font-medium leading-tight text-neutral-strong">
            {t.label}
          </dt>
          {t.sub ? (
            <span className="font-mono text-[10.5px] leading-tight text-neutral">
              {t.sub}
            </span>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
