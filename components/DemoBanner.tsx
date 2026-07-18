import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";

/**
 * Persistent, non-dismissable honesty strip: every number on the map is demo
 * data until field collection begins. Slim, keyed to the amber caution token
 * (status, not the pink signal), never a marketing banner. Sits below MapChrome
 * when the demo era is on; theme/locale/home live in MapChrome instead.
 */
export default function DemoBanner() {
  const t = useTranslations("demoBanner");

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-1.5 text-[11.5px] font-medium leading-snug text-ink sm:px-4 sm:text-[12.5px]"
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
    </div>
  );
}
