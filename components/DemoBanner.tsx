import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import ThemeSwitcher from "@/components/ThemeSwitcher";

/**
 * Persistent, non-dismissable honesty strip: every number on the map is demo
 * data until field collection begins. Slim, keyed to the amber caution token
 * (status, not the pink signal), never a marketing banner. It doubles as the
 * map surface's header, so it carries the theme switcher at its right edge (the
 * message stays centered in the space beside it).
 */
export default function DemoBanner() {
  const t = useTranslations("demoBanner");

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-[11.5px] font-medium leading-snug text-ink sm:px-4 sm:text-[12.5px]"
    >
      <span className="flex flex-1 items-center justify-center gap-2 text-balance text-center">
        <FlaskConical
          size={14}
          strokeWidth={1.75}
          className="mt-px shrink-0 self-start text-amber sm:mt-0 sm:self-center"
          aria-hidden="true"
        />
        <span>{t("message")}</span>
      </span>
      <ThemeSwitcher className="shrink-0 text-neutral-strong" />
    </div>
  );
}
