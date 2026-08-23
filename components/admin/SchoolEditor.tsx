"use client";

/**
 * Everything an admin can do to one school, on one page.
 *
 * Four panels, ordered by how often they are used and how much damage they can
 * do: the evidence (read-only, always the truth), the written assessment, the
 * descriptive profile, and last the override — which is the only control here
 * that can make the published number disagree with the arithmetic, and is
 * therefore the one placed furthest from an idle click.
 *
 * The contribution table is the heart of it. An editor's real question is never
 * "what is the score", it is "why is it that, and do I believe it" — so every
 * row shows the segment, its ring, its distance, its weight share, the points it
 * contributed, and where its reading came from. A score you cannot take apart is
 * a score nobody will defend in a meeting.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ClipboardCheck, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import type { MemberContribution, SchoolScore, SchoolTier } from "@/lib/school-score";
import type { SchoolAssessment, SchoolOverride, SchoolProfile } from "@/lib/school-store";
import SchoolZoneMap, { type ZoneSegmentGeometry } from "@/components/admin/SchoolZoneMap";
import styles from "@/components/ui/zen.module.css";

const TIERS: SchoolTier[] = ["sin_datos", "critico", "en_riesgo", "en_progreso", "escuela_segura"];
const TIER_LABEL: Record<SchoolTier, string> = {
  sin_datos: "Sin datos suficientes",
  critico: "Crítico",
  en_riesgo: "En riesgo",
  en_progreso: "En progreso",
  escuela_segura: "Escuela Segura",
};

type Props = {
  schoolId: string;
  displayName: string;
  registryName: string;
  computed: SchoolScore;
  published: { tier: SchoolTier; score: number | null; compliance: number | null; overridden: boolean };
  profile: SchoolProfile | null;
  override: SchoolOverride | null;
  assessment: SchoolAssessment | null;
  center: [number, number];
  gateRadiusM: number;
  walkRadiusM: number;
  geometry: ZoneSegmentGeometry[];
  gapLengthM: number;
  registryAddress: string | null;
  hasPhoto: boolean;
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(100 * v)}%`);

export default function SchoolEditor(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const gapIds = useMemo(
    () => new Set(props.geometry.filter((g) => !g.assessed).map((g) => g.id)),
    [props.geometry],
  );

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNote(null);
    try {
      const res = await fetch("/api/admin/schools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: props.schoolId, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(`Failed: ${json.error ?? res.status}`);
        return false;
      }
      // A refresh with no model configured still succeeded at re-reading the
      // segments; say which happened rather than claiming a draft was written.
      setNote(
        json.drafted === false && json.reason
          ? `Figures refreshed. No assessment drafted (${json.reason}).`
          : "Saved.",
      );
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      setNote(`Failed: ${(err as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {note && (
        <p
          role="status"
          className="rounded-[6px] border border-border bg-surface-sunken px-3 py-2 font-mono text-[12px] text-ink"
        >
          {note}
        </p>
      )}

      {/* ── The evidence ────────────────────────────────────────────────── */}
      <section className={`${styles.card} flex flex-col gap-4 rounded-[8px] border border-border p-4`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[1.05rem] text-ink">What the arithmetic says</h2>
          <button
            type="button"
            onClick={() => post({ action: "refresh" }, "refresh")}
            disabled={busy !== null || pending}
            className="flex items-center gap-1.5 rounded-[6px] border border-border-strong px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-ink disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
            {busy === "refresh" ? "Refreshing…" : "Refresh from live segments"}
          </button>
        </header>

        {/* The score is recomputed on every read, so this button is not what
            makes it current. It re-reads, re-stamps, and redrafts the written
            assessment against the new numbers. */}
        <p className="text-[11.5px] leading-snug text-neutral-strong">
          Scores recompute on every page load from current segment readings, so these
          figures are already live. Refresh re-drafts the written assessment against them.
        </p>

        <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 sm:grid-cols-4">
          {[
            ["Tier", TIER_LABEL[props.computed.tier]],
            ["School Score", props.computed.score === null ? "—" : `${props.computed.score}`],
            ["Ley 7600", pct(props.computed.compliance)],
            ["Zone surveyed", pct(props.computed.coverage)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[10.5px] text-neutral-strong">{label}</dt>
              <dd className="font-mono text-[1.05rem] font-medium leading-none text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {props.computed.gate_veto && (
          <p className="flex items-start gap-2 rounded-[6px] border border-accent px-3 py-2 text-[12px] leading-snug text-ink">
            <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span>
              <strong>Gate veto.</strong> {props.computed.gate_veto_segments.length} segment(s) inside
              the gate ring score below the safety floor, which caps this school at Crítico whatever
              its average says: {props.computed.gate_veto_segments.join(", ")}.
            </span>
          </p>
        )}

        {props.computed.seal.blockers.length > 0 && (
          <p className="text-[11.5px] text-neutral-strong">
            Seal blocked by: <span className="font-mono text-ink">{props.computed.seal.blockers.join(", ")}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-neutral-strong">
          <span>{props.computed.counts.assessed}/{props.computed.counts.members} segments recorded</span>
          <span>{props.computed.counts.gate_assessed}/{props.computed.counts.gate_members} in the gate ring</span>
          <span>{Math.round(props.gapLengthM)} m still to record</span>
        </div>

        <SchoolZoneMap
          center={props.center}
          gateRadiusM={props.gateRadiusM}
          walkRadiusM={props.walkRadiusM}
          segments={props.geometry}
          selectedId={selected}
          onSelect={setSelected}
        />

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-strong">
          <span>Solid = counted · Dashed accent = not yet recorded · Thick = gate ring (counts double)</span>
        </div>

        <ContributionTable
          rows={props.computed.contributions}
          gapIds={gapIds}
          selected={selected}
          onSelect={setSelected}
        />
      </section>

      {/* ── The written assessment ─────────────────────────────────────── */}
      <AssessmentPanel
        assessment={props.assessment}
        busy={busy}
        onDraft={() => post({ action: "assess" }, "assess")}
        onSave={(overall, overall_es) =>
          post({ action: "save-assessment", overall, overall_es }, "save-assessment")
        }
      />

      {/* ── The profile ────────────────────────────────────────────────── */}
      <ProfilePanel
        schoolId={props.schoolId}
        profile={props.profile}
        registryName={props.registryName}
        registryAddress={props.registryAddress}
        hasPhoto={props.hasPhoto}
        busy={busy}
        onSave={(patch) => post({ action: "profile", patch }, "profile")}
        onChanged={() => startTransition(() => router.refresh())}
      />

      {/* ── The override, last and loudest ─────────────────────────────── */}
      <OverridePanel
        override={props.override}
        computedTier={props.computed.tier}
        computedScore={props.computed.score}
        busy={busy}
        onSave={(tier, score, reason) => post({ action: "override", tier, score, reason }, "override")}
        onClear={() => post({ action: "clear" }, "clear")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Contribution table
 * ------------------------------------------------------------------ */

function ContributionTable({
  rows,
  gapIds,
  selected,
  onSelect,
}: Readonly<{
  rows: MemberContribution[];
  gapIds: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-[12px]">
        <caption className="mb-2 text-left text-[11.5px] text-neutral-strong">
          Every segment in the zone and what it contributed. Weight is length × ring
          weight; an unrecorded segment carries zero weight and counts against coverage
          instead.
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-strong">
            <th scope="col" className="py-1.5 pr-2">Segment</th>
            <th scope="col" className="py-1.5 pr-2">Ring</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Walk</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Length</th>
            <th scope="col" className="py-1.5 pr-2">Evidence</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Acc</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Weight</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Points</th>
            <th scope="col" className="py-1.5">Ley 7600</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.segment_id}
              onMouseEnter={() => onSelect(r.segment_id)}
              onFocus={() => onSelect(r.segment_id)}
              tabIndex={0}
              data-selected={selected === r.segment_id ? "true" : "false"}
              className="border-b border-border align-top data-[selected=true]:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <td className="py-1.5 pr-2">
                <span className="block truncate text-ink">{r.name}</span>
                <span className="font-mono text-[10px] text-neutral-strong">{r.segment_id}</span>
              </td>
              <td className="py-1.5 pr-2 font-mono text-[10.5px] text-neutral-strong">{r.ring}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-neutral-strong">
                {Math.round(r.walk_m)} m
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-neutral-strong">
                {Math.round(r.length_m)} m
              </td>
              <td className="py-1.5 pr-2">
                {gapIds.has(r.segment_id) ? (
                  <span className="flex items-center gap-1 font-mono text-[10.5px] text-accent-text">
                    <Camera size={11} strokeWidth={2} aria-hidden="true" /> to record
                  </span>
                ) : (
                  <span className="font-mono text-[10.5px] text-neutral-strong">{r.source}</span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">
                {r.scores ? r.scores.accessibility : "—"}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-neutral-strong">
                {r.assessed ? `${Math.round(1000 * r.weight_share) / 10}%` : "—"}
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">
                {r.assessed ? r.points.toFixed(2) : "—"}
              </td>
              <td className="py-1.5 font-mono text-[10.5px]">
                {r.ley7600 === null ? (
                  <span className="text-neutral-strong">—</span>
                ) : r.ley7600 === "pass" ? (
                  <span className="text-ink">pass</span>
                ) : (
                  <span className="text-accent-text">fail</span>
                )}
                {r.veto && <span className="ml-1 text-accent-text">· veto</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Assessment
 * ------------------------------------------------------------------ */

function AssessmentPanel({
  assessment,
  busy,
  onDraft,
  onSave,
}: Readonly<{
  assessment: SchoolAssessment | null;
  busy: string | null;
  onDraft: () => void;
  onSave: (overall: string, overallEs: string) => void;
}>) {
  const [overall, setOverall] = useState(assessment?.overall ?? "");
  const [overallEs, setOverallEs] = useState(assessment?.overall_es ?? "");

  return (
    <section className={`${styles.card} flex flex-col gap-3 rounded-[8px] border border-border p-4`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[1.05rem] text-ink">Written assessment</h2>
        <button
          type="button"
          onClick={onDraft}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-[6px] border border-border-strong px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-ink disabled:opacity-50"
        >
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          {busy === "assess" ? "Drafting…" : "Draft from the figures"}
        </button>
      </header>

      {assessment && (
        <p className="font-mono text-[10.5px] text-neutral-strong">
          {assessment.origin === "model"
            ? `Model-written (${assessment.model ?? "unknown model"})`
            : "Edited by the team"}
          {assessment.coverage_at_write != null &&
            ` · written at ${Math.round(100 * assessment.coverage_at_write)}% coverage`}
        </p>
      )}

      {/* The model never sees a score it can change — it is handed the finished
          arithmetic and asked for prose. Editing here flips the provenance label
          to "team", because a label that survives editing is a lie. */}
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-neutral-strong">English</span>
        <textarea
          value={overall}
          onChange={(e) => setOverall(e.target.value)}
          rows={4}
          className="w-full rounded-[6px] border border-border bg-surface-elevated p-2.5 text-[13px] leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-neutral-strong">Español</span>
        <textarea
          value={overallEs}
          onChange={(e) => setOverallEs(e.target.value)}
          rows={4}
          className="w-full rounded-[6px] border border-border bg-surface-elevated p-2.5 text-[13px] leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </label>
      <div>
        <button
          type="button"
          onClick={() => onSave(overall, overallEs)}
          disabled={busy !== null || !overall.trim()}
          className="rounded-[6px] border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-surface disabled:opacity-50"
        >
          {busy === "save-assessment" ? "Saving…" : "Save assessment"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

function ProfilePanel({
  schoolId,
  profile,
  registryName,
  registryAddress,
  hasPhoto,
  busy,
  onSave,
  onChanged,
}: Readonly<{
  schoolId: string;
  profile: SchoolProfile | null;
  registryName: string;
  registryAddress: string | null;
  hasPhoto: boolean;
  busy: string | null;
  onSave: (patch: Record<string, unknown>) => void;
  onChanged: () => void;
}>) {
  const [form, setForm] = useState({
    display_name: profile?.display_name ?? "",
    address: profile?.address ?? "",
    level: profile?.level ?? "",
    enrollment: profile?.enrollment != null ? String(profile.enrollment) : "",
    principal: profile?.principal ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    website: profile?.website ?? "",
    notes: profile?.notes ?? "",
  });
  const [uploading, setUploading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function upload(file: File) {
    setUploading(true);
    const body = new FormData();
    body.set("id", schoolId);
    body.set("photo", file);
    await fetch("/api/admin/schools/photo", { method: "POST", body });
    setUploading(false);
    onChanged();
  }

  return (
    <section className={`${styles.card} flex flex-col gap-3 rounded-[8px] border border-border p-4`}>
      <h2 className="font-display text-[1.05rem] text-ink">School information</h2>
      <p className="text-[11.5px] leading-snug text-neutral-strong">
        All optional. Anything left blank falls through to the MEP register, so clearing a
        field restores the registry value rather than blanking the school.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" placeholder={registryName} value={form.display_name} onChange={set("display_name")} />
        <Field label="Address" placeholder={registryAddress ?? "—"} value={form.address} onChange={set("address")} />
        {/* Enrolment is the number that upgrades intervention priority off its
            proxy — the MEP register does not carry it, so this is its only home. */}
        <Field label="Enrolment (matrícula)" value={form.enrollment} onChange={set("enrollment")} inputMode="numeric" />
        <Field label="Level" placeholder="primary, secondary…" value={form.level} onChange={set("level")} />
        <Field label="Principal" value={form.principal} onChange={set("principal")} />
        <Field label="Phone" value={form.phone} onChange={set("phone")} />
        <Field label="Email" value={form.email} onChange={set("email")} type="email" />
        <Field label="Website" value={form.website} onChange={set("website")} type="url" />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-neutral-strong">Notes</span>
        <textarea
          value={form.notes}
          onChange={set("notes")}
          rows={3}
          placeholder="Access, which gate is actually used, who to call before turning up with a camera."
          className="w-full rounded-[6px] border border-border bg-surface-elevated p-2.5 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {hasPhoto && (
          /* eslint-disable-next-line @next/next/no-img-element -- local admin
             preview of an uploaded file; no remote loader is configured. */
          <img
            src={`/api/schools/${schoolId}/photo`}
            alt=""
            className="h-14 w-20 rounded-[4px] border border-border object-cover"
          />
        )}
        <label className="cursor-pointer rounded-[6px] border border-border-strong px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-ink">
          {uploading ? "Uploading…" : hasPhoto ? "Replace photo" : "Upload photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {hasPhoto && (
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/admin/schools/photo?id=${encodeURIComponent(schoolId)}`, { method: "DELETE" });
              onChanged();
            }}
            className="flex items-center gap-1.5 rounded-[6px] border border-border px-2.5 py-1.5 text-[12px] text-neutral-strong hover:border-ink hover:text-ink"
          >
            <Trash2 size={13} strokeWidth={2} aria-hidden="true" /> Remove
          </button>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() =>
            onSave({
              ...form,
              enrollment: form.enrollment === "" ? null : form.enrollment,
            })
          }
          disabled={busy !== null}
          className="rounded-[6px] border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-surface disabled:opacity-50"
        >
          {busy === "profile" ? "Saving…" : "Save information"}
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  ...rest
}: Readonly<{ label: string } & React.InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] text-neutral-strong">{label}</span>
      <input
        {...rest}
        className="w-full rounded-[6px] border border-border bg-surface-elevated px-2.5 py-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Override
 * ------------------------------------------------------------------ */

function OverridePanel({
  override,
  computedTier,
  computedScore,
  busy,
  onSave,
  onClear,
}: Readonly<{
  override: SchoolOverride | null;
  computedTier: SchoolTier;
  computedScore: number | null;
  busy: string | null;
  onSave: (tier: SchoolTier | null, score: string, reason: string) => void;
  onClear: () => void;
}>) {
  const [tier, setTier] = useState<string>(override?.tier ?? "");
  const [score, setScore] = useState(override?.score != null ? String(override.score) : "");
  const [reason, setReason] = useState(override?.reason ?? "");

  return (
    <section className="flex flex-col gap-3 rounded-[8px] border border-accent/50 p-4">
      <header className="flex items-center gap-2">
        <ClipboardCheck size={15} strokeWidth={2} className="text-accent" aria-hidden="true" />
        <h2 className="font-display text-[1.05rem] text-ink">Manual override</h2>
      </header>
      {/* An override is the only control on this page that makes the published
          number disagree with the streets underneath it. It is labelled on every
          public surface, and the computed figure is kept beside it, so the
          disagreement is always visible rather than silently resolved. */}
      <p className="text-[11.5px] leading-snug text-neutral-strong">
        Publishes a figure that differs from the arithmetic. The computed value stays
        visible here and the public card is labelled as overridden. Leave a field blank to
        keep the computed value for it.
      </p>

      {override && (
        <p className="rounded-[6px] border border-border bg-surface-sunken px-3 py-2 font-mono text-[11px] text-ink">
          Active override by {override.author} · {new Date(override.created_at).toLocaleString()} ·
          computed was {TIER_LABEL[computedTier]} / {computedScore ?? "—"}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-neutral-strong">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="w-full rounded-[6px] border border-border bg-surface-elevated px-2.5 py-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <option value="">Keep computed ({TIER_LABEL[computedTier]})</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>{TIER_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <Field
          label={`Score (computed ${computedScore ?? "—"})`}
          value={score}
          inputMode="decimal"
          onChange={(e) => setScore(e.target.value)}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-neutral-strong">Reason (required, min 8 characters)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Field audit on 12 Aug found the crossing rebuilt; camera pass predates the works."
          className="w-full rounded-[6px] border border-border bg-surface-elevated p-2.5 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSave(tier === "" ? null : (tier as SchoolTier), score, reason)}
          disabled={busy !== null || reason.trim().length < 8}
          className="rounded-[6px] border border-accent bg-accent px-3 py-2 text-[12px] font-medium text-accent-fg disabled:opacity-50"
        >
          {busy === "override" ? "Publishing…" : "Publish override"}
        </button>
        {override && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy !== null}
            className="rounded-[6px] border border-border-strong px-3 py-2 text-[12px] font-medium text-ink hover:border-ink disabled:opacity-50"
          >
            {busy === "clear" ? "Clearing…" : "Remove override"}
          </button>
        )}
      </div>
    </section>
  );
}
