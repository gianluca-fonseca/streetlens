"use client";

/**
 * Per-segment reviewer dialogue panel: chat with #N pills, Converse / Recompute.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Sparkles, Loader2 } from "lucide-react";
import {
  tokenizeFrameRefsValidated,
  type FrameRefToken,
} from "@/lib/extraction/guided-frame-refs";
import type { ReviewDialogueMessage } from "@/lib/capture/dialogue-store";
import type { ReviewCorrections } from "@/lib/capture/review-overrides";
import type { SegmentAssessment, SegmentAssessmentEs } from "@/lib/capture/schemas";
import type { LensKey } from "@/lib/capture/scoring";
import styles from "@/components/ui/zen.module.css";

export type DialogueSuccessPayload = {
  suggestRecompute: boolean;
  assessment: SegmentAssessment | null;
  assessmentEs: SegmentAssessmentEs | null;
  manualScores: Partial<Record<LensKey, number | null>> | null;
  messages: ReviewDialogueMessage[];
};

type Props = {
  sessionId: string;
  segmentId: string;
  knownSeqs: readonly number[];
  corrections: ReviewCorrections;
  initialMessages?: ReviewDialogueMessage[];
  disabled?: boolean;
  onSelectFrame: (seq: number) => void;
  onSuccess: (payload: DialogueSuccessPayload) => void;
};

function MessageBody({
  text,
  knownSeqs,
  onSelectFrame,
}: {
  text: string;
  knownSeqs: ReadonlySet<number>;
  onSelectFrame: (seq: number) => void;
}) {
  const tokens = useMemo(
    () => tokenizeFrameRefsValidated(text, knownSeqs),
    [text, knownSeqs],
  );
  return (
    <span className="whitespace-pre-wrap break-words">
      {tokens.map((tok, i) => (
        <Token key={`${i}-${tok.kind}`} tok={tok} onSelectFrame={onSelectFrame} />
      ))}
    </span>
  );
}

function Token({
  tok,
  onSelectFrame,
}: {
  tok: FrameRefToken;
  onSelectFrame: (seq: number) => void;
}) {
  if (tok.kind === "text") return <>{tok.value}</>;
  if (tok.kind === "invalid") {
    return (
      <span
        className="mx-0.5 inline-flex items-center rounded-full border border-clay/50 bg-clay/10 px-1.5 py-0.5 font-mono text-[10.5px] text-clay line-through"
        title="Invalid frame reference"
      >
        {tok.raw}
      </span>
    );
  }
  const label = tok.from === tok.to ? `#${tok.from}` : `#${tok.from}–${tok.to}`;
  return (
    <button
      type="button"
      onClick={() => onSelectFrame(tok.from)}
      className="mx-0.5 inline-flex items-center rounded-full border border-accent/45 bg-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink hover:bg-accent/20"
    >
      {label}
    </button>
  );
}

export default function ReviewDialoguePanel({
  sessionId,
  segmentId,
  knownSeqs,
  corrections,
  initialMessages = [],
  disabled = false,
  onSelectFrame,
  onSuccess,
}: Props) {
  const t = useTranslations("admin.capture.dialogue");
  const [messages, setMessages] = useState<ReviewDialogueMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestRecompute, setSuggestRecompute] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const knownSet = useMemo(() => new Set(knownSeqs), [knownSeqs]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const send = useCallback(
    async (mode: "converse" | "recompute") => {
      const text = draft.trim();
      if (!text || busy || disabled) return;
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/admin/capture/dialogue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            segment_id: segmentId,
            message: text,
            mode,
            corrections,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          assistant_message?: string;
          suggest_recompute?: boolean;
          messages?: ReviewDialogueMessage[];
          assessment?: SegmentAssessment | null;
          assessment_es?: SegmentAssessmentEs | null;
          manual_scores?: Partial<Record<LensKey, number | null>> | null;
        };
        if (!res.ok) {
          if (body.error === "extraction_disabled") setError(t("extractionDisabled"));
          else setError(t("error"));
          return;
        }
        setDraft("");
        const nextMessages = body.messages ?? messages;
        setMessages(nextMessages);
        const ready = Boolean(body.suggest_recompute);
        setSuggestRecompute(ready);
        onSuccess({
          suggestRecompute: ready,
          assessment: body.assessment ?? null,
          assessmentEs: body.assessment_es ?? null,
          manualScores: body.manual_scores ?? null,
          messages: nextMessages,
        });
      } catch {
        setError(t("error"));
      } finally {
        setBusy(false);
      }
    },
    [draft, busy, disabled, sessionId, segmentId, corrections, messages, onSuccess, t],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send("converse");
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send("recompute");
    }
  };

  const draftTokens = useMemo(
    () => (draft ? tokenizeFrameRefsValidated(draft, knownSet) : []),
    [draft, knownSet],
  );
  const draftPills = draftTokens.filter(
    (tok): tok is Extract<FrameRefToken, { kind: "ref" | "invalid" }> =>
      tok.kind === "ref" || tok.kind === "invalid",
  );

  return (
    <section
      className="mt-3 rounded-[8px] border border-border bg-surface-sunken/60 p-3"
      aria-label={t("title")}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
          {t("title")}
        </span>
        <span className="text-[10.5px] text-neutral-strong">{t("hint")}</span>
      </div>

      <div
        ref={listRef}
        className="mb-2 max-h-48 space-y-2 overflow-y-auto rounded-[6px] border border-border bg-surface-base p-2"
      >
        {messages.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-neutral-strong">{t("empty")}</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-[6px] px-2 py-1.5 text-[12.5px] leading-snug ${
                m.role === "reviewer"
                  ? "ml-4 border border-pine/30 bg-pine/5 text-ink"
                  : "mr-4 border border-border bg-surface-elevated text-ink"
              }`}
            >
              <p className="mb-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
                {m.role === "reviewer" ? t("you") : t("model")}
                {m.recompute ? ` · ${t("recomputeTag")}` : ""}
              </p>
              <MessageBody text={m.content} knownSeqs={knownSet} onSelectFrame={onSelectFrame} />
            </div>
          ))
        )}
        {busy ? (
          <p className="flex items-center gap-1.5 px-1 text-[12px] text-neutral-strong">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            {t("working")}
          </p>
        ) : null}
      </div>

      {draftPills.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1" aria-label={t("frameRefs")}>
          {draftPills.map((tok, i) =>
            tok.kind === "invalid" ? (
              <span
                key={`d-${i}`}
                className="inline-flex rounded-full border border-clay/50 bg-clay/10 px-1.5 py-0.5 font-mono text-[10.5px] text-clay line-through"
              >
                {tok.raw}
              </span>
            ) : (
              <button
                key={`d-${i}`}
                type="button"
                onClick={() => onSelectFrame(tok.from)}
                className="inline-flex rounded-full border border-accent/45 bg-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink hover:bg-accent/20"
              >
                {tok.from === tok.to ? `#${tok.from}` : `#${tok.from}–${tok.to}`}
              </button>
            ),
          )}
        </div>
      ) : null}

      <label className="sr-only" htmlFor={`dialogue-${segmentId}`}>
        {t("inputLabel")}
      </label>
      <textarea
        id={`dialogue-${segmentId}`}
        rows={2}
        disabled={disabled || busy}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("placeholder")}
        className="w-full resize-y rounded-[6px] border border-border bg-surface-base px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-neutral-strong focus-visible:border-border-strong"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || busy || !draft.trim()}
          onClick={() => void send("converse")}
          className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border border-border bg-surface-elevated px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-surface-sunken disabled:opacity-55`}
        >
          {t("converse")}
        </button>
        <button
          type="button"
          disabled={disabled || busy || !draft.trim()}
          onClick={() => void send("recompute")}
          className={`${styles.control} inline-flex items-center gap-1 rounded-[4px] border px-2.5 py-1 text-[12px] font-medium disabled:opacity-55 ${
            suggestRecompute
              ? "border-accent/55 bg-accent/15 text-ink ring-1 ring-accent/40"
              : "border-accent/45 bg-accent/10 text-ink hover:bg-accent/15"
          }`}
        >
          <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" />
          {t("recompute")}
        </button>
        <span className="text-[10.5px] text-neutral-strong">{t("keyboardHint")}</span>
      </div>

      {error ? (
        <p className="mt-1.5 text-[12px] text-clay" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
