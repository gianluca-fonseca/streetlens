"use client";

/**
 * The pre-walk screens: what this is, what it needs, and why.
 *
 * The explainer is not filler. This asks a stranger to point a camera down a
 * public street and hand us the result, so it says plainly what is captured,
 * what it is stamped with, what becomes public, and what not to point it at.
 * Permission prompts land AFTER the walker has read that, and only on a tap:
 * iOS requires the gesture, and asking cold is how you get a denial you never
 * recover from.
 */

import { useTranslations } from "next-intl";
import { Camera, MapPin, Sun } from "lucide-react";
import { Action, Eyebrow, Notice, Plate, Screen } from "@/components/capture/ui";
import type { CameraState } from "@/components/capture/hooks/useCamera";
import type { SegmentBrief } from "@/lib/capture/segment-brief";

function Ask({
  icon,
  title,
  hint,
}: Readonly<{ icon: React.ReactNode; title: string; hint: string }>) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-strong">{hint}</span>
      </span>
    </li>
  );
}

export function StartScreen({
  onStart,
  starting,
  camera,
  durable,
  spotBrief,
}: Readonly<{
  onStart: () => void;
  starting: boolean;
  camera: CameraState;
  durable: boolean;
  spotBrief?: SegmentBrief | null;
}>) {
  const t = useTranslations("collect");

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{spotBrief ? t("mission.eyebrow") : t("start.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {spotBrief ? t("mission.title", { street: spotBrief.name }) : t("start.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {spotBrief ? t("mission.lead", { district: spotBrief.district }) : t("start.lead")}
        </p>
      </header>

      {spotBrief ? (
        <Plate className="flex items-start gap-2 p-4">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-semibold text-ink">{spotBrief.name}</p>
            <p className="mt-0.5 text-[12px] text-neutral-strong">{spotBrief.district}</p>
          </div>
        </Plate>
      ) : null}

      {camera.status === "error" ? (
        <Notice tone="stop" title={t(`camera.${camera.reason}_title`)}>
          {t(`camera.${camera.reason}_body`)}
        </Notice>
      ) : null}

      {!durable ? <Notice tone="warn">{t("hud.notDurable")}</Notice> : null}

      <Plate className="p-4">
        <Eyebrow>{t("start.howEyebrow")}</Eyebrow>
        <ol className="mt-3 flex list-none flex-col gap-2">
          {[t("start.how1"), t("start.how2"), t("start.how3")].map((line, i) => (
            <li key={line} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink">
              <span
                className="mt-px font-mono text-[12px] tabular-nums text-ink-faint"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
      </Plate>

      <Plate className="p-4">
        <Eyebrow>{t("start.asksEyebrow")}</Eyebrow>
        <ul className="mt-3 flex list-none flex-col gap-3">
          <Ask
            icon={<Camera size={18} strokeWidth={1.75} />}
            title={t("start.askCamera")}
            hint={t("start.askCameraHint")}
          />
          <Ask
            icon={<MapPin size={18} strokeWidth={1.75} />}
            title={t("start.askLocation")}
            hint={t("start.askLocationHint")}
          />
          <Ask
            icon={<Sun size={18} strokeWidth={1.75} />}
            title={t("start.askScreen")}
            hint={t("start.askScreenHint")}
          />
        </ul>
      </Plate>

      <div className="flex flex-col gap-3">
        <Action variant="accent" onClick={onStart} disabled={starting}>
          {starting ? t("start.ctaStarting") : t("start.cta")}
        </Action>
        <p className="text-[12px] leading-relaxed text-neutral-strong">{t("start.privacy")}</p>
      </div>
    </Screen>
  );
}
