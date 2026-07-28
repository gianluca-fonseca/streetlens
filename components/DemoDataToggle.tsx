"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useDemoData } from "@/components/DemoDataProvider";
import { setDemoData } from "@/lib/demo-flag-actions";
import { cn } from "@/components/ui/cn";

/**
 * The demo-data switch: turns the simulated pilot scores on and off live, with
 * no rebuild. A real `role="switch"` button, so it is keyboard operable, exposes
 * its on/off state to assistive tech, and takes the same visible focus ring as
 * the rest of the map chrome.
 *
 * It switches the DATA, never the honesty strip: while the demo era is on, the
 * `DemoBanner` stays up and non-dismissable.
 *
 * The server action writes the cookie; `router.refresh()` then refetches the
 * locale layout so the resolved flag, the map payload, and every stat move
 * together in one pass.
 */
export default function DemoDataToggle({
  className,
}: Readonly<{ className?: string }>) {
  const t = useTranslations("demoToggle");
  const router = useRouter();
  const enabled = useDemoData();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={pending}
      disabled={pending}
      title={t("hint")}
      onClick={() =>
        startTransition(async () => {
          await setDemoData(!enabled);
          router.refresh();
        })
      }
      className={cn(
        "inline-flex min-h-[32px] pointer-coarse:min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-current/25 px-2 py-1 text-[12px] font-medium text-ink-muted transition-colors",
        "hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        pending && "opacity-60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-[14px] w-[24px] shrink-0 rounded-full transition-colors",
          enabled ? "bg-amber" : "bg-current/30",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[10px] w-[10px] rounded-full bg-surface transition-[left]",
            enabled ? "left-[12px]" : "left-[2px]",
          )}
        />
      </span>
      <span className="whitespace-nowrap">{t("label")}</span>
    </button>
  );
}
