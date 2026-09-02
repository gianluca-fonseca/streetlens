import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import { getSchoolReport } from "@/lib/school-report";
import { getSegments } from "@/lib/segments";
import AdminHeader from "@/components/admin/AdminHeader";
import SchoolEditor from "@/components/admin/SchoolEditor";
import type { ZoneSegmentGeometry } from "@/components/admin/SchoolZoneMap";

export const dynamic = "force-dynamic";

/**
 * One school's desk: the evidence, the assessment, the profile, the override.
 *
 * Geometry for the zone map is resolved here rather than in the client so the
 * browser never downloads the full 1,457-feature network to draw twenty of them.
 */
export default async function AdminSchoolPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale; id: string }> }>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const demo = await demoDataEnabled();
  const report = await getSchoolReport(id, demo);
  if (!report || !report.zone) notFound();

  const segments = await getSegments(demo);
  const byId = new Map(segments.features.map((f) => [f.properties.id, f]));
  const vetoes = new Set(report.computed.gate_veto_segments);

  const geometry: ZoneSegmentGeometry[] = report.computed.contributions
    .map((c) => {
      const feature = byId.get(c.segment_id);
      if (!feature || feature.geometry.type !== "LineString") return null;
      return {
        id: c.segment_id,
        name: c.name,
        ring: c.ring,
        assessed: c.assessed,
        veto: vetoes.has(c.segment_id),
        coordinates: feature.geometry.coordinates as [number, number][],
      };
    })
    .filter((g): g is ZoneSegmentGeometry => g !== null);

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader locale={locale} active="schools" />
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-5 px-4 pb-16">
        <Link
          href={`/${locale}/admin/schools`}
          className="flex w-max items-center gap-1.5 font-mono text-[11.5px] text-neutral-strong hover:text-ink"
        >
          <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" /> All schools
        </Link>

        <header className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-strong">
            {report.school.sector === "public" ? "Público · MEP" : "Privado"}
            {report.school.mep_code ? ` · ${report.school.mep_code}` : ""}
          </p>
          <h1 className="font-display text-[1.6rem] leading-tight text-ink">
            {report.display_name}
          </h1>
          {report.address && (
            <p className="text-[13px] text-neutral-strong">{report.address}</p>
          )}
        </header>

        <SchoolEditor
          schoolId={report.school.id}
          displayName={report.display_name}
          registryName={report.school.display_name}
          registryAddress={report.school.address}
          computed={report.computed}
          published={report.published}
          profile={report.profile}
          override={report.override}
          assessment={report.assessment}
          center={report.center}
          gateRadiusM={report.zone.gate_radius_m}
          walkRadiusM={report.zone.walk_radius_m}
          geometry={geometry}
          gapLengthM={report.gap_length_m}
          hasPhoto={Boolean(report.profile?.photo)}
        />
      </div>
    </div>
  );
}
