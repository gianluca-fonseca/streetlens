"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Camera,
  Check,
  Locate,
  MapPin,
  PencilLine,
  Plus,
  Route,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { submissionSchema, type Submission } from "@/lib/schemas";
import {
  CONDITION_KEYS,
  CONDITION_OPTIONS,
  isMeaningfulTier,
  type ConditionKey,
  type ConditionState,
} from "@/components/contribute/conditions";
import type { ContributeApi } from "@/components/contribute/useContribute";
import styles from "@/components/ui/zen.module.css";

const HIGHWAY_KEYS = [
  "residential",
  "tertiary",
  "secondary",
  "unclassified",
  "footway",
  "path",
  "living_street",
] as const;
type HighwayKey = (typeof HIGHWAY_KEYS)[number];

// Contribute form panels float over live map tiles → Recipe A glass (dossier §4
// maps panel-sized surfaces to A, small pills to C). Fields inside stay SOLID
// (INPUT below) so there is no stacked glass.
const PANEL = `${styles.glassPanel} pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-[12px]`;
// 16px on phones keeps iOS from auto-zooming the viewport on field focus; the
// sealed 13px control returns at sm+.
const INPUT =
  "w-full rounded-[4px] border border-border bg-surface-elevated px-2.5 py-2 text-[16px] text-ink placeholder:text-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]";
const LABEL = "mb-1 block text-[12px] font-medium text-ink";
// rev-5 primary = ink fill / paper label. Flips by theme: near-black fill + paper
// label in light (17.49:1), creme fill + dark-paper label in dark (17.75:1). Both
// clear AA. (Retires the rev-4 fixed-dark-pine + white-text pair.)
const PRIMARY_BTN = `${styles.controlSoft} inline-flex items-center justify-center gap-1.5 rounded-[4px] bg-ink-display px-3.5 py-2 text-[13px] font-semibold text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-surface-elevated disabled:pointer-events-none disabled:opacity-50`;
const GHOST_BTN = `${styles.control} inline-flex items-center justify-center gap-1.5 rounded-[4px] border border-border bg-surface-elevated px-3 py-2 text-[13px] font-medium text-ink hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`;

/** Gentle one-time slide-up on mount (entrance on user action, not idle motion). */
function SlideUp({ children }: Readonly<{ children: React.ReactNode }>) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={[
        // Entrance on user action; motion-reduce collapses to an instant appear.
        "transition-all duration-300 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function useCompiledNote() {
  const t = useTranslations("contribute");
  return (conditions: ConditionState, userNote: string): string => {
    const parts = CONDITION_KEYS.filter((k) =>
      isMeaningfulTier(conditions[k] ?? ""),
    ).map(
      (k) =>
        `${t(`conditions.${k}.label`)}: ${t(
          `conditions.${k}.options.${conditions[k]}` as Parameters<typeof t>[0],
        )}`,
    );
    const report = parts.length
      ? `[${t("compiledNoteHeading")}] ${parts.join(" · ")}`
      : "";
    return [report, userNote.trim()].filter(Boolean).join(" — ");
  };
}

function ConditionFields({
  conditions,
  onChange,
}: Readonly<{
  conditions: ConditionState;
  onChange: (key: ConditionKey, value: string) => void;
}>) {
  const t = useTranslations("contribute");
  return (
    <div className="flex flex-col gap-2.5">
      {CONDITION_KEYS.map((key) => (
        <div key={key}>
          <label className={LABEL} htmlFor={`cond-${key}`}>
            {t(`conditions.${key}.label`)}
          </label>
          <select
            id={`cond-${key}`}
            className={INPUT}
            value={conditions[key] ?? ""}
            onChange={(e) => onChange(key, e.target.value)}
          >
            <option value="">—</option>
            {CONDITION_OPTIONS[key].map((opt) => (
              <option key={opt} value={opt}>
                {t(`conditions.${key}.options.${opt}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function HoneypotField({
  value,
  onChange,
}: Readonly<{ value: string; onChange: (v: string) => void }>) {
  // Hidden from humans (off-screen, not tabbable, aria-hidden). A filled value
  // signals a bot; the server rejects it. Field name looks innocuous.
  return (
    <input
      type="text"
      name="website"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
    />
  );
}

function PhotoPlaceholder() {
  // Field for the future: photo upload arrives with the pilot. Honest, disabled.
  const t = useTranslations("contribute");
  return (
    <div>
      <span className={LABEL}>
        {t("form.photoLabel")}{" "}
        <span className="font-normal text-neutral-strong">
          ({t("form.noteOptional")})
        </span>
      </span>
      <div className="flex items-center gap-2.5 rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-3 py-2.5">
        <Camera
          size={18}
          strokeWidth={1.75}
          className="shrink-0 text-neutral"
          aria-hidden="true"
        />
        <span className="text-[11px] leading-snug text-neutral-strong">
          {t("form.photoSoon")}
        </span>
      </div>
    </div>
  );
}

function ViewTraceButton({
  coords,
  onView,
}: Readonly<{ coords: readonly unknown[]; onView: () => void }>) {
  // Secondary action: flies the camera back to the relevant geometry, which
  // fitBounds places left of the right-docked form. Hidden without geometry.
  const t = useTranslations("contribute");
  if (coords.length === 0) return null;
  return (
    <button type="button" onClick={onView} className={`${GHOST_BTN} self-start`}>
      <Locate size={15} strokeWidth={1.75} aria-hidden="true" />
      {t("form.viewTrace")}
    </button>
  );
}

function ErrorLine({ messageKey }: Readonly<{ messageKey: string | null }>) {
  const t = useTranslations("contribute");
  if (!messageKey) return null;
  return (
    <p
      role="alert"
      className="rounded-[4px] border border-clay/40 bg-clay/10 px-2.5 py-1.5 text-[12px] text-ink"
    >
      {t(`errors.${messageKey}` as Parameters<typeof t>[0])}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

function Fab({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const t = useTranslations("contribute");
  return (
    <SlideUp>
      <button
        type="button"
        onClick={onOpen}
        className={`pointer-events-auto ${PRIMARY_BTN}`}
      >
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("fab")}
      </button>
    </SlideUp>
  );
}

function ChoosePanel({
  onTrace,
  onSelect,
  onCancel,
}: Readonly<{
  onTrace: () => void;
  onSelect: () => void;
  onCancel: () => void;
}>) {
  const t = useTranslations("contribute");
  return (
    <SlideUp>
      <section aria-label={t("choose.title")} className={PANEL}>
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-[1.05rem] font-semibold leading-tight text-ink">
              {t("choose.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-snug text-neutral-strong">
              {t("choose.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("choose.cancel")}
            className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="flex flex-col gap-2 p-4">
          <button
            type="button"
            onClick={onTrace}
            className={`${styles.control} flex items-start gap-3 rounded-[8px] border border-border bg-surface-elevated p-3 text-left hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
          >
            <Route
              size={18}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <span>
              <span className="block text-[13px] font-semibold text-ink">
                {t("choose.addSegment")}
              </span>
              <span className="mt-0.5 block text-[12px] text-neutral-strong">
                {t("choose.addSegmentHint")}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onSelect}
            className={`${styles.control} flex items-start gap-3 rounded-[8px] border border-border bg-surface-elevated p-3 text-left hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
          >
            <PencilLine
              size={18}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <span>
              <span className="block text-[13px] font-semibold text-ink">
                {t("choose.proposeUpdate")}
              </span>
              <span className="mt-0.5 block text-[12px] text-neutral-strong">
                {t("choose.proposeUpdateHint")}
              </span>
            </span>
          </button>
          {/* The recorder is a page, not a mode: it needs a camera, a wake lock
              and its own full-screen chrome, none of which fit inside a panel
              floating over the map. So this one is a Link and not a button, and
              it leaves the map behind rather than mutating contribute's state. */}
          <Link
            href="/collect"
            className={`${styles.control} flex items-start gap-3 rounded-[8px] border border-border bg-surface-elevated p-3 text-left hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
          >
            <Camera
              size={18}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <span>
              <span className="block text-[13px] font-semibold text-ink">
                {t("choose.recordWalk")}
              </span>
              <span className="mt-0.5 block text-[12px] text-neutral-strong">
                {t("choose.recordWalkHint")}
              </span>
            </span>
          </Link>
        </div>
      </section>
    </SlideUp>
  );
}

function InstructionPill({
  title,
  hint,
  onCancel,
  cancelLabel,
}: Readonly<{
  title: string;
  hint: string;
  onCancel: () => void;
  cancelLabel: string;
}>) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 justify-center px-3">
      <div className={`${styles.glassChip} pointer-events-auto flex items-center gap-3 rounded-[8px] px-3 py-2`}>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">{title}</p>
          <p className="text-[11px] leading-snug text-neutral-strong">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={cancelLabel}
          className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function FollowStreetsToggle({
  on,
  onToggle,
}: Readonly<{ on: boolean; onToggle: () => void }>) {
  const t = useTranslations("contribute");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={[
        "inline-flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
        on
          ? "border-hairline-strong bg-surface-sunken text-ink"
          : "border-border bg-surface-elevated text-neutral-strong hover:border-border-strong",
      ].join(" ")}
    >
      <Route size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>{t("followStreets.label")}</span>
      <span
        aria-hidden="true"
        className={[
          "ml-0.5 inline-flex h-3.5 w-6 items-center rounded-full px-0.5 transition-colors",
          on ? "bg-accent" : "bg-hairline-strong",
        ].join(" ")}
      >
        <span
          className={[
            "h-2.5 w-2.5 rounded-full bg-paper-white transition-transform",
            on ? "translate-x-2.5" : "translate-x-0",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

function TraceControls({
  count,
  followStreets,
  hasFallback,
  onToggleFollow,
  onUndo,
  onClear,
  onFinish,
}: Readonly<{
  count: number;
  followStreets: boolean;
  hasFallback: boolean;
  onToggleFollow: () => void;
  onUndo: () => void;
  onClear: () => void;
  onFinish: () => void;
}>) {
  const t = useTranslations("contribute");
  return (
    <SlideUp>
      <div className={`${styles.glassPanel} pointer-events-auto flex flex-col gap-2 rounded-[8px] px-3 py-2`}>
        <div className="flex items-center gap-2">
          <FollowStreetsToggle on={followStreets} onToggle={onToggleFollow} />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-neutral-strong">
            {t("trace.points", { count })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={count === 0}
              className={`${GHOST_BTN} px-2`}
              aria-label={t("trace.undo")}
            >
              <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={count === 0}
              className={`${GHOST_BTN} px-2`}
              aria-label={t("trace.clear")}
            >
              <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onFinish}
              disabled={count < 2}
              className={PRIMARY_BTN}
            >
              <Check size={15} strokeWidth={1.75} aria-hidden="true" />
              {t("trace.finish")}
            </button>
          </div>
        </div>
        {followStreets && hasFallback ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-neutral-strong">
            <TriangleAlert
              size={13}
              strokeWidth={1.75}
              className="mt-px shrink-0 text-amber"
              aria-hidden="true"
            />
            {t("followStreets.warning")}
          </p>
        ) : null}
      </div>
    </SlideUp>
  );
}

function AddForm({
  contribute,
}: Readonly<{ contribute: ContributeApi }>) {
  const t = useTranslations("contribute");
  const compile = useCompiledNote();
  const [name, setName] = useState("");
  const [highway, setHighway] = useState<HighwayKey | "">("");
  const [conditions, setConditions] = useState<ConditionState>({});
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // The routed polyline (follows streets when on), not the raw user dots.
  const coords = contribute.pathCoordinates;
  const canSubmit =
    name.trim().length > 0 && highway !== "" && coords.length >= 2;
  const submitting = contribute.submitState === "submitting";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const compiled = compile(conditions, note);
    const submission = {
      type: "add_segment" as const,
      payload: {
        name: name.trim(),
        highway: highway as HighwayKey,
        coordinates: coords,
        ...(compiled ? { note: compiled } : {}),
      },
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      honeypot,
    };
    const parsed = submissionSchema.safeParse(submission);
    if (!parsed.success) {
      setLocalError("invalid");
      return;
    }
    await contribute.submit(parsed.data as Submission);
  };

  return (
    <SlideUp>
      <form onSubmit={onSubmit} className={PANEL}>
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-[1.05rem] font-semibold leading-tight text-ink">
              {t("form.addTitle")}
            </h2>
            <p className="mt-1 font-mono text-[11px] text-neutral-strong">
              {t("form.pathPoints", { count: coords.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={contribute.cancel}
            aria-label={t("form.cancel")}
            className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 p-4">
          <HoneypotField value={honeypot} onChange={setHoneypot} />

          <ViewTraceButton
            coords={coords}
            onView={() => contribute.flyToCoords(coords)}
          />

          {contribute.hasFallback ? (
            <p className="flex items-start gap-1.5 rounded-[4px] border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[11px] leading-snug text-ink">
              <TriangleAlert
                size={13}
                strokeWidth={1.75}
                className="mt-px shrink-0 text-amber"
                aria-hidden="true"
              />
              {t("followStreets.warning")}
            </p>
          ) : null}

          <div>
            <label className={LABEL} htmlFor="add-name">
              {t("form.nameLabel")}
            </label>
            <input
              id="add-name"
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              maxLength={160}
              required
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="add-highway">
              {t("form.highwayLabel")}
            </label>
            <select
              id="add-highway"
              className={INPUT}
              value={highway}
              onChange={(e) => setHighway(e.target.value as HighwayKey | "")}
              required
            >
              <option value="">{t("form.highwayPlaceholder")}</option>
              {HIGHWAY_KEYS.map((h) => (
                <option key={h} value={h}>
                  {t(`highways.${h}`)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="border-t border-border pt-3">
            <legend className="mb-1 text-[12px] font-semibold text-ink">
              {t("form.conditionsTitle")}
            </legend>
            <p className="mb-2.5 text-[11px] text-neutral-strong">
              {t("form.conditionsHint")}
            </p>
            <ConditionFields
              conditions={conditions}
              onChange={(k, v) => setConditions((c) => ({ ...c, [k]: v }))}
            />
          </fieldset>

          <div>
            <label className={LABEL} htmlFor="add-note">
              {t("form.noteLabel")}{" "}
              <span className="font-normal text-neutral-strong">
                ({t("form.noteOptional")})
              </span>
            </label>
            <textarea
              id="add-note"
              className={`${INPUT} min-h-16 resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("form.notePlaceholder")}
              maxLength={800}
            />
          </div>

          <PhotoPlaceholder />

          <div>
            <label className={LABEL} htmlFor="add-contact">
              {t("form.contactLabel")}{" "}
              <span className="font-normal text-neutral-strong">
                ({t("form.contactOptional")})
              </span>
            </label>
            <input
              id="add-contact"
              className={INPUT}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("form.contactPlaceholder")}
              maxLength={200}
            />
            <p className="mt-1 text-[11px] text-neutral-strong">
              {t("form.contactHint")}
            </p>
          </div>

          <ErrorLine messageKey={localError ?? contribute.errorKey} />

          <p className="text-[11px] leading-snug text-neutral-strong">
            {t("form.honestNote")}
          </p>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button type="button" onClick={contribute.startTrace} className={GHOST_BTN}>
            {t("form.redraw")}
          </button>
          <button type="submit" disabled={!canSubmit || submitting} className={PRIMARY_BTN}>
            {submitting ? t("form.submitting") : t("form.submit")}
          </button>
        </footer>
      </form>
    </SlideUp>
  );
}

function UpdateForm({
  contribute,
}: Readonly<{ contribute: ContributeApi }>) {
  const t = useTranslations("contribute");
  const compile = useCompiledNote();
  const picked = contribute.picked;
  const [name, setName] = useState(picked?.name ?? "");
  const [highway, setHighway] = useState<HighwayKey | "">("");
  const [conditions, setConditions] = useState<ConditionState>({});
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submitting = contribute.submitState === "submitting";
  const compiledNote = compile(conditions, note);

  // Build the patch from actual changes only (schema requires ≥1 field).
  const patch: { name?: string; highway?: HighwayKey; note?: string } = {};
  if (picked && name.trim() && name.trim() !== picked.name) {
    patch.name = name.trim();
  }
  if (highway !== "") patch.highway = highway;
  if (compiledNote) patch.note = compiledNote;

  const canSubmit =
    !!picked && reason.trim().length > 0 && Object.keys(patch).length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setLocalError(null);
    const submission = {
      type: "update_segment" as const,
      payload: {
        segment_id: picked.id,
        patch,
        reason: reason.trim(),
      },
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      honeypot,
    };
    const parsed = submissionSchema.safeParse(submission);
    if (!parsed.success) {
      setLocalError("invalid");
      return;
    }
    await contribute.submit(parsed.data as Submission);
  };

  return (
    <SlideUp>
      <form onSubmit={onSubmit} className={PANEL}>
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="font-display text-[1.05rem] font-semibold leading-tight text-ink">
              {t("form.updateTitle")}
            </h2>
            <p className="mt-1 truncate text-[12px] text-neutral-strong">
              {t("form.editingSegment")}: {picked?.name}
            </p>
          </div>
          <button
            type="button"
            onClick={contribute.cancel}
            aria-label={t("form.cancel")}
            className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 p-4">
          <HoneypotField value={honeypot} onChange={setHoneypot} />

          <ViewTraceButton
            coords={picked?.coordinates ?? []}
            onView={() =>
              picked && contribute.flyToCoords(picked.coordinates)
            }
          />

          <div>
            <label className={LABEL} htmlFor="upd-name">
              {t("form.nameLabel")}
            </label>
            <input
              id="upd-name"
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="upd-highway">
              {t("form.highwayLabel")}{" "}
              <span className="font-normal text-neutral-strong">
                ({t("form.noteOptional")})
              </span>
            </label>
            <select
              id="upd-highway"
              className={INPUT}
              value={highway}
              onChange={(e) => setHighway(e.target.value as HighwayKey | "")}
            >
              <option value="">{t("form.highwayPlaceholder")}</option>
              {HIGHWAY_KEYS.map((h) => (
                <option key={h} value={h}>
                  {t(`highways.${h}`)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="border-t border-border pt-3">
            <legend className="mb-1 text-[12px] font-semibold text-ink">
              {t("form.conditionsTitle")}
            </legend>
            <p className="mb-2.5 text-[11px] text-neutral-strong">
              {t("form.conditionsHint")}
            </p>
            <ConditionFields
              conditions={conditions}
              onChange={(k, v) => setConditions((c) => ({ ...c, [k]: v }))}
            />
          </fieldset>

          <div>
            <label className={LABEL} htmlFor="upd-note">
              {t("form.noteLabel")}{" "}
              <span className="font-normal text-neutral-strong">
                ({t("form.noteOptional")})
              </span>
            </label>
            <textarea
              id="upd-note"
              className={`${INPUT} min-h-14 resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("form.notePlaceholder")}
              maxLength={800}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="upd-reason">
              {t("form.reasonLabel")}
            </label>
            <textarea
              id="upd-reason"
              className={`${INPUT} min-h-16 resize-y`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("form.reasonPlaceholder")}
              maxLength={1000}
              required
            />
          </div>

          <PhotoPlaceholder />

          <div>
            <label className={LABEL} htmlFor="upd-contact">
              {t("form.contactLabel")}{" "}
              <span className="font-normal text-neutral-strong">
                ({t("form.contactOptional")})
              </span>
            </label>
            <input
              id="upd-contact"
              className={INPUT}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("form.contactPlaceholder")}
              maxLength={200}
            />
            <p className="mt-1 text-[11px] text-neutral-strong">
              {t("form.contactHint")}
            </p>
          </div>

          <ErrorLine messageKey={localError ?? contribute.errorKey} />

          <p className="text-[11px] leading-snug text-neutral-strong">
            {t("form.honestNote")}
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button type="submit" disabled={!canSubmit || submitting} className={PRIMARY_BTN}>
            {submitting ? t("form.submitting") : t("form.submit")}
          </button>
        </footer>
      </form>
    </SlideUp>
  );
}

function SuccessCard({
  onAddAnother,
  onClose,
}: Readonly<{ onAddAnother: () => void; onClose: () => void }>) {
  const t = useTranslations("contribute");
  return (
    <SlideUp>
      <section aria-label={t("success.title")} className={PANEL}>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-accent text-accent-fg">
              <MapPin size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2 className="font-display text-[1.05rem] font-semibold leading-tight text-ink">
              {t("success.title")}
            </h2>
          </div>
          <p className="text-[12.5px] leading-snug text-neutral-strong">
            {t("success.body")}
          </p>
          <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" onClick={onAddAnother} className={GHOST_BTN}>
              {t("success.addAnother")}
            </button>
            <button type="button" onClick={onClose} className={PRIMARY_BTN}>
              {t("success.close")}
            </button>
          </div>
        </div>
      </section>
    </SlideUp>
  );
}

export default function ContributeUI({
  contribute,
}: Readonly<{ contribute: ContributeApi }>) {
  const t = useTranslations("contribute");
  const { mode, submitState } = contribute;

  const showInstruction = mode === "trace" || mode === "select";
  // Tall forms dock on the right (clear of the top-left stats panel); the small
  // FAB / menu / toolbar / confirmation stay bottom-left (a free, quiet corner
  // that never covers MapLibre's bottom-right attribution).
  const rightDock = mode === "add" || mode === "update";
  // On phones the dock is bottom-anchored; pad it off the home bar. At sm+ it
  // returns to the sealed corner docking (no safe-area padding needed).
  const dockClass = rightDock
    ? "inset-x-0 bottom-0 justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:top-[4.75rem] sm:bottom-4 sm:items-start sm:justify-end sm:p-0"
    : "inset-x-0 bottom-0 justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-4 sm:bottom-4 sm:justify-start sm:p-0";

  return (
    <>
      {showInstruction ? (
        <InstructionPill
          title={t(mode === "trace" ? "trace.title" : "select.title")}
          hint={t(mode === "trace" ? "trace.hint" : "select.hint")}
          onCancel={contribute.cancel}
          cancelLabel={t(mode === "trace" ? "trace.cancel" : "select.cancel")}
        />
      ) : null}

      <div className={`pointer-events-none absolute z-20 flex ${dockClass}`}>
        {submitState === "success" ? (
          <SuccessCard
            onAddAnother={() => {
              contribute.reset();
              contribute.open();
            }}
            onClose={contribute.reset}
          />
        ) : mode === "idle" ? (
          <Fab onOpen={contribute.open} />
        ) : mode === "choose" ? (
          <ChoosePanel
            onTrace={contribute.startTrace}
            onSelect={contribute.startSelect}
            onCancel={contribute.cancel}
          />
        ) : mode === "trace" ? (
          <TraceControls
            count={contribute.dots.length}
            followStreets={contribute.followStreets}
            hasFallback={contribute.hasFallback}
            onToggleFollow={contribute.toggleFollowStreets}
            onUndo={contribute.undo}
            onClear={contribute.clear}
            onFinish={contribute.finishTrace}
          />
        ) : mode === "add" ? (
          <AddForm contribute={contribute} />
        ) : mode === "update" ? (
          <UpdateForm contribute={contribute} />
        ) : null}
      </div>
    </>
  );
}
