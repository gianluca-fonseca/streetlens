"use client";

import { useTranslations } from "next-intl";
import { Notice } from "@/components/capture/ui";
import { deriveCoachHints, type CoachInput } from "@/lib/capture/quality-coach";

export function QualityCoachRail({ input }: Readonly<{ input: CoachInput }>) {
  const t = useTranslations("collect.coach");
  const hints = deriveCoachHints(input);

  if (hints.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {hints.map((hint) => (
        <Notice key={hint.id} tone="warn">
          {t(hint.id)}
        </Notice>
      ))}
    </div>
  );
}
