"use client";

import { useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";
import { SCHOOL_PIN } from "@/components/mapConfig";
import { useTheme } from "@/components/ThemeProvider";

/**
 * The schools overlay switch, and the key to the two pin forms in one control.
 *
 * It is a switch rather than a sixth entry in the LayerSwitcher because schools
 * are not a lens: the switcher is a radiogroup that answers "which score am I
 * looking at", and a school is not a score. Putting it there would have made
 * "schools" mutually exclusive with "accessibility", which is precisely
 * backwards — the whole school-safety argument is the two read TOGETHER.
 *
 * The key rides along inside the control instead of taking its own Legend block,
 * because the marks it explains only exist while the switch is on, and a legend
 * entry for something not drawn is how a legend stops being trusted.
 */
export default function SchoolsToggle({
  active,
  counts,
  onToggle,
}: Readonly<{
  active: boolean;
  counts: { public: number; private: number };
  onToggle: (next: boolean) => void;
}>) {
  const t = useTranslations("schools");
  const { resolved } = useTheme();
  const pin = SCHOOL_PIN[resolved === "dark" ? "dark" : "light"];
  const total = counts.public + counts.private;

  return (
    <div className="rounded-[8px] border border-border bg-surface-sunken p-1.5">
      <label className="flex cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-2 pointer-coarse:min-h-[44px]">
        <GraduationCap
          size={16}
          strokeWidth={1.75}
          className={active ? "text-accent" : "text-neutral-strong"}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-[13px] font-medium text-ink">
          {t("toggleLabel")}
        </span>
        <span className="font-mono text-[11px] text-neutral-strong">{total}</span>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-[15px] w-[15px] shrink-0 accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-surface-sunken"
        />
      </label>

      {/* The key. Hidden from assistive tech while the overlay is off, for the
          same reason it is dimmed: it describes marks that are not on the map. */}
      <ul
        aria-hidden={!active}
        className={[
          "flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 pb-1.5 pt-0.5 transition-opacity",
          active ? "opacity-100" : "opacity-40",
        ].join(" ")}
      >
        {(
          [
            ["public", pin.fill, pin.ring],
            ["private", pin.hollow, pin.stroke],
          ] as const
        ).map(([sector, fill, stroke]) => (
          <li key={sector} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
              style={{ backgroundColor: fill, boxShadow: `0 0 0 1.5px ${stroke}` }}
            />
            <span className="text-[11.5px] text-neutral-strong">
              {t(`sector.${sector}`)}
              <span className="ml-1 font-mono text-[10.5px]">{counts[sector]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
