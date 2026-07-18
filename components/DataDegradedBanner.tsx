import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import ThemeSwitcher from "@/components/ThemeSwitcher";

/**
 * Shown when Supabase is configured but a live segment/CV read failed (0025).
 * The page may still render static fallback data; this strip says so explicitly.
 */
export default function DataDegradedBanner() {
  const t = useTranslations("dataDegradedBanner");

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-amber/45 bg-amber/10 px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-[11.5px] font-medium leading-snug text-ink sm:px-4 sm:text-[12.5px]"
    >
      <span className="flex flex-1 items-center justify-center gap-2 text-balance text-center">
        <TriangleAlert
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
