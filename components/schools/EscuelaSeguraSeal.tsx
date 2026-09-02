/**
 * The Escuela Segura seal.
 *
 * ── WHAT A CERTIFICATION MARK HAS TO DO ────────────────────────────────────
 * Bandera Azul and carbon-neutral marks work because they are legible at
 * thumbnail size on a wall by a school gate, they name the awarding body, and
 * they carry a date that makes them expire. This mark is built to those three
 * constraints, not to look like a logo.
 *
 *   the crossing    The centre is a zebra crossing in perspective, narrowing
 *                   toward a single point. It is the most universally read
 *                   symbol for "a child crosses here", it is the intervention
 *                   the standard most often asks for, and it works at 24 px.
 *                   A school building or a graduation cap would say "school",
 *                   which is exactly the thing this seal does NOT certify.
 *   the ring text   Names the standard and the canton, because a seal that does
 *                   not say where it applies is decoration.
 *   the year band   The seal expires. A street is not safe forever, and a mark
 *                   with no date is a claim nobody can ever retire.
 *
 * ── ON CO-BRANDING ─────────────────────────────────────────────────────────
 * The mark belongs to the STANDARD, not to whoever funds it. The awarding
 * body's logo sits beside it in a lockup, under the words "otorgado por" —
 * separate, not merged. That separation is the whole reason these seals carry
 * weight: Bandera Azul works because the flag is the programme's and the
 * sponsor is named next to it, so a sponsor changing does not invalidate every
 * mark ever issued.
 *
 * Pass the partner's real asset as `awardedBy`. The component deliberately
 * ships an empty, labelled slot rather than a drawn stand-in, because a
 * fabricated logo in a proposal deck reads as a real endorsement that has not
 * been given yet.
 */

import type { ReactNode } from "react";
import type { SchoolTier } from "@/lib/school-score";

/**
 * Only two visual states, not five.
 *
 * A seal is a PASS mark. Minting "Crítico" and "En riesgo" variants would turn
 * a certification into a public shaming badge a school could be handed, which
 * is both cruel and self-defeating — the point is to get a school fixed, not to
 * label it. Schools below the bar get a rating on the map and a place on the
 * intervention list; they do not get a seal with their failure printed in it.
 */
export type SealState = "awarded" | "pending";

export function sealStateFor(tier: SchoolTier): SealState {
  return tier === "escuela_segura" ? "awarded" : "pending";
}

export default function EscuelaSeguraSeal({
  size = 160,
  state = "awarded",
  municipality = "Cantón de Escazú",
  validUntil,
  className,
  title,
}: Readonly<{
  size?: number;
  state?: SealState;
  municipality?: string;
  /** Year the seal lapses. Omit only for a blank specimen. */
  validUntil?: number;
  className?: string;
  title?: string;
}>) {
  const pending = state === "pending";
  const label = title ?? `Escuela Segura · ${municipality}`;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      // currentColor throughout: the seal inherits the ink of whatever surface
      // it sits on, so one file works on paper, on the dark map, and on a slide.
      fill="none"
      stroke="currentColor"
    >
      <title>{label}</title>
      <defs>
        {/* Two arcs for the ring text. The bottom one runs left-to-right along
            the underside so the words read normally rather than upside down. */}
        <path id="es-seal-top" d="M 26 100 A 74 74 0 0 1 174 100" />
        <path id="es-seal-bottom" d="M 30 100 A 70 70 0 0 0 170 100" />
      </defs>

      {/* Outer rule, then a hairline inset. The double ring is what makes a
          circle read as a seal rather than as a button. */}
      <circle cx="100" cy="100" r="96" strokeWidth={pending ? 1.5 : 3} opacity={pending ? 0.55 : 1} />
      <circle cx="100" cy="100" r="88" strokeWidth="0.75" opacity="0.5" />

      {/* A pending seal is dashed: visibly the same mark, visibly not yet
          earned. It is the specimen a school can be shown as a target. */}
      {pending && (
        <circle
          cx="100"
          cy="100"
          r="92"
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity="0.6"
        />
      )}

      <g fill="currentColor" stroke="none">
        <text
          fontSize="15"
          fontWeight="600"
          letterSpacing="3.2"
          fontFamily="var(--font-display, system-ui), system-ui, sans-serif"
        >
          <textPath href="#es-seal-top" startOffset="50%" textAnchor="middle">
            ESCUELA SEGURA
          </textPath>
        </text>
        <text
          fontSize="8.5"
          letterSpacing="2.1"
          opacity="0.72"
          fontFamily="var(--font-mono, ui-monospace), ui-monospace, monospace"
        >
          <textPath href="#es-seal-bottom" startOffset="50%" textAnchor="middle">
            {municipality.toUpperCase()}
          </textPath>
        </text>
      </g>

      {/* The crossing. Bars narrow and shorten toward the top so the eye reads
          a path going away from it, toward the figure at the gate. */}
      <g strokeLinecap="round">
        {[
          { y: 120, half: 30, w: 7.6 },
          { y: 109, half: 24, w: 6.3 },
          { y: 99, half: 18.5, w: 5.2 },
          { y: 90, half: 13.5, w: 4.2 },
        ].map((bar) => (
          <line
            key={bar.y}
            x1={100 - bar.half}
            y1={bar.y}
            x2={100 + bar.half}
            y2={bar.y}
            strokeWidth={bar.w}
            opacity={pending ? 0.4 : 1}
          />
        ))}
      </g>

      {/* The child at the far side: one disc, no face, no figure. A pictogram
          person at this size becomes a smudge; a disc stays a disc. */}
      <circle
        cx="100"
        cy="69"
        r="7.5"
        fill="currentColor"
        stroke="none"
        opacity={pending ? 0.4 : 1}
      />

      {/* Validity. The band is only drawn when there is a year to put in it —
          an empty band on a specimen would read as a missing value. */}
      {validUntil !== undefined && (
        <g>
          <line x1="74" y1="130" x2="126" y2="130" strokeWidth="0.75" opacity="0.45" />
          <text
            x="100"
            y="142"
            textAnchor="middle"
            fontSize="10"
            letterSpacing="1.6"
            fill="currentColor"
            stroke="none"
            opacity="0.72"
            fontFamily="var(--font-mono, ui-monospace), ui-monospace, monospace"
          >
            {pending ? "NO ACREDITADA" : `VIGENTE ${validUntil}`}
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * The seal beside the body that awards it.
 *
 * "Otorgado por" is not decoration. A measurement organisation awarding its own
 * seal is the weakest form of certification and invites exactly the credibility
 * critique the standard exists to survive, so the lockup makes the separation
 * structural: StreetLens measures, and a named convener awards.
 */
export function SealLockup({
  awardedBy,
  awardedByLabel = "Otorgado por",
  verifiedByLabel = "Medición verificada por",
  verifiedBy = "StreetLens",
  ...seal
}: Readonly<
  React.ComponentProps<typeof EscuelaSeguraSeal> & {
    /** The convening body's own asset. Left empty on purpose until there is
     *  one — a drawn stand-in would read as an endorsement not yet given. */
    awardedBy?: ReactNode;
    awardedByLabel?: string;
    verifiedByLabel?: string;
    verifiedBy?: ReactNode;
  }
>) {
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-5">
      <EscuelaSeguraSeal {...seal} />

      <div className="flex flex-col gap-4 border-l border-border pl-7">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-strong">
            {awardedByLabel}
          </span>
          {awardedBy ?? (
            <span
              className="flex h-11 w-[9.5rem] items-center justify-center rounded-[4px] border border-dashed border-border-strong font-mono text-[9.5px] uppercase tracking-[0.1em] text-neutral-strong"
              aria-label="Awarding body logo goes here"
            >
              logo del ente
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-strong">
            {verifiedByLabel}
          </span>
          <span className="font-display text-[0.95rem] font-semibold text-ink">{verifiedBy}</span>
        </div>
      </div>
    </div>
  );
}
