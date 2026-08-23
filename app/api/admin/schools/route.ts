import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import { getSchoolReport } from "@/lib/school-report";
import {
  clearSchoolOverride,
  saveSchoolAssessment,
  saveSchoolOverride,
  saveSchoolProfile,
} from "@/lib/school-store";
import { AssessmentUnavailable, draftSchoolAssessment } from "@/lib/school-assessment";
import { revalidatePublicMapPages } from "@/lib/revalidate-map";
import type { SchoolTier } from "@/lib/school-score";

// fs (local overlays) + Web Crypto (session verify): Node.js runtime.
export const runtime = "nodejs";

const TIERS: SchoolTier[] = [
  "sin_datos",
  "critico",
  "en_riesgo",
  "en_progreso",
  "escuela_segura",
];

const str = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== "string") return undefined as unknown as null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * POST /api/admin/schools — every school-side admin mutation, by `action`.
 *
 * One route rather than five, because these all share the same guard, the same
 * id lookup, and the same revalidation, and splitting them would mean copying
 * that preamble four times. Re-verifies the session independently of the proxy
 * guard: the proxy matcher excludes /api, so auth has to be enforced here.
 *
 * Actions:
 *   profile   merge descriptive fields (all optional, never touches a score)
 *   override  publish a human tier/score in place of the computed one
 *   clear     drop the override, returning the school to its arithmetic
 *   assess    draft the written reading from the CURRENT numbers
 *   save-assessment  store a hand-written or hand-edited reading
 *   refresh   re-read live segments, re-stamp, and redraft if a model is set up
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!id || !action) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const demo = await demoDataEnabled();
  const report = await getSchoolReport(id, demo);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });

  switch (action) {
    case "profile": {
      const patch = body.patch as Record<string, unknown> | undefined;
      if (!patch || typeof patch !== "object") {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }
      // Whitelist, so a crafted body cannot write `photo` (which only the upload
      // route may set) or invent fields the read path would then trust.
      const enrollmentRaw = patch.enrollment;
      const enrollment =
        enrollmentRaw === null || enrollmentRaw === ""
          ? null
          : Number.isFinite(Number(enrollmentRaw))
            ? Math.max(0, Math.round(Number(enrollmentRaw)))
            : undefined;

      const saved = await saveSchoolProfile(id, {
        ...(patch.display_name !== undefined ? { display_name: str(patch.display_name) } : {}),
        ...(patch.address !== undefined ? { address: str(patch.address) } : {}),
        ...(patch.level !== undefined ? { level: str(patch.level) } : {}),
        ...(patch.principal !== undefined ? { principal: str(patch.principal) } : {}),
        ...(patch.phone !== undefined ? { phone: str(patch.phone) } : {}),
        ...(patch.email !== undefined ? { email: str(patch.email) } : {}),
        ...(patch.website !== undefined ? { website: str(patch.website) } : {}),
        ...(patch.notes !== undefined ? { notes: str(patch.notes) } : {}),
        ...(enrollment !== undefined ? { enrollment } : {}),
      });
      revalidatePublicMapPages();
      return NextResponse.json({ ok: true, profile: saved });
    }

    case "override": {
      const reason = str(body.reason);
      // An override without a reason is indistinguishable from a mistake, and
      // this number ends up in a partner's deck.
      if (!reason || reason.length < 8) {
        return NextResponse.json({ error: "reason_required" }, { status: 422 });
      }
      const tier = body.tier === null ? null : (body.tier as SchoolTier);
      if (tier !== null && !TIERS.includes(tier)) {
        return NextResponse.json({ error: "bad_tier" }, { status: 422 });
      }
      const scoreRaw = body.score;
      const score =
        scoreRaw === null || scoreRaw === ""
          ? null
          : Number.isFinite(Number(scoreRaw))
            ? Math.min(100, Math.max(0, Number(scoreRaw)))
            : null;

      await saveSchoolOverride({
        school_id: id,
        tier,
        score,
        reason,
        author: str(body.author) ?? "admin",
        created_at: new Date().toISOString(),
      });
      revalidatePublicMapPages();
      return NextResponse.json({ ok: true });
    }

    case "clear": {
      await clearSchoolOverride(id);
      revalidatePublicMapPages();
      return NextResponse.json({ ok: true });
    }

    case "assess":
    case "refresh": {
      // Both re-read the live segments — getSchoolReport above already did, so
      // the numbers in hand are current by construction. The difference is only
      // whether a failed draft is fatal.
      try {
        const drafted = await draftSchoolAssessment({
          school_name: report.display_name,
          sector: report.school.sector,
          level: report.school.level,
          district: report.school.district,
          score: report.computed,
          gap_length_m: report.gap_length_m,
          gap_count: report.gaps.length,
        });
        await saveSchoolAssessment({
          school_id: id,
          overall: drafted.overall,
          overall_es: drafted.overall_es || null,
          findings: drafted.findings,
          origin: "model",
          model: drafted.model,
          scored_at: new Date().toISOString(),
          coverage_at_write: report.computed.coverage,
          updated_at: new Date().toISOString(),
        });
        revalidatePublicMapPages();
        return NextResponse.json({ ok: true, drafted: true, score: report.computed });
      } catch (err) {
        if (err instanceof AssessmentUnavailable) {
          // A refresh whose numbers moved is still a successful refresh even
          // when no model is configured; only an explicit "assess" is a failure.
          const status = action === "refresh" ? 200 : 503;
          return NextResponse.json(
            { ok: action === "refresh", drafted: false, reason: err.message, score: report.computed },
            { status },
          );
        }
        throw err;
      }
    }

    case "save-assessment": {
      const overall = str(body.overall);
      if (!overall) return NextResponse.json({ error: "empty" }, { status: 422 });
      await saveSchoolAssessment({
        school_id: id,
        overall,
        overall_es: str(body.overall_es),
        findings: Array.isArray(body.findings)
          ? (body.findings as { text?: unknown; segment_id?: unknown }[])
              .filter((f) => typeof f?.text === "string" && f.text.trim())
              .map((f) => ({
                text: (f.text as string).trim(),
                segment_id: typeof f.segment_id === "string" ? f.segment_id : null,
              }))
          : [],
        // Touched by a person, so it stops claiming to be model output. A
        // provenance label that survives editing is a lie about provenance.
        origin: "human",
        model: report.assessment?.model ?? null,
        scored_at: report.assessment?.scored_at ?? null,
        coverage_at_write: report.computed.coverage,
        author: str(body.author) ?? "admin",
        updated_at: new Date().toISOString(),
      });
      revalidatePublicMapPages();
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
