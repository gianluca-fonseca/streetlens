import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";

/**
 * Persistent, non-dismissable honesty strip: every number on the map is demo
 * data until field collection begins. Slim, keyed to the amber caution token
 * (status, not the pink signal), never a marketing banner.
 */
export default function DemoBanner() {
  const t = useTranslations("demoBanner");

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-surface-sunken px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-[11.5px] font-medium leading-snug text-balance text-ink sm:px-4 sm:text-[12.5px]"
    >
      <FlaskConical
        size={14}
        strokeWidth={1.75}
        className="mt-px shrink-0 self-start text-amber sm:mt-0 sm:self-center"
        aria-hidden="true"
      />
      <span>{t("message")}</span>
    </div>
  );
}
