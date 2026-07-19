import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import CivicChrome from "@/components/civic/CivicChrome";
import PrintButton from "@/components/civic/PrintButton";
import { formatCvCoveragePct } from "@/lib/cv-provenance";
import { AUTHOR_LINKEDIN, CUSP_URL, GITHUB_URL } from "@/lib/links";
import { MUNICIPALITY } from "@/lib/municipality";
import { getStats } from "@/lib/segments";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "press.meta" });
  return {
    title: t("title"),
    description: t("description", { municipality: MUNICIPALITY.name }),
  };
}

export default async function PressPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "press" });
  const stats = await getStats();
  const cvCoverage = formatCvCoveragePct(stats.cvCoveragePct, locale);

  return (
    <CivicChrome
      locale={locale}
      homeLabel={t("home")}
      actions={<PrintButton label={t("downloadPdf")} />}
    >
      <article className="mt-4 flex flex-col gap-8">
        <header>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-ink-display sm:text-[2rem]">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-[40rem] font-serif text-[1.05rem] leading-relaxed text-ink-muted">
            {t("elevator", { municipality: MUNICIPALITY.name })}
          </p>
        </header>

        <section aria-labelledby="press-what-heading">
          <h2
            id="press-what-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("whatHeading")}
          </h2>
          <p className="mt-2 font-serif text-[1rem] leading-relaxed text-ink-muted">
            {t("whatBody")}
          </p>
        </section>

        <section aria-labelledby="press-pilot-heading">
          <h2
            id="press-pilot-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("pilotHeading")}
          </h2>
          <p className="mt-2 font-serif text-[1rem] leading-relaxed text-ink-muted">
            {t("pilotBody", {
              municipality: MUNICIPALITY.name,
              country: MUNICIPALITY.country,
            })}
          </p>
        </section>

        <section aria-labelledby="press-figures-heading">
          <h2
            id="press-figures-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("figuresHeading")}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statCvSegments")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {stats.cvSegments}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statCvSessions")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {stats.cvSessionsReviewed}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statCvCoverage")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {cvCoverage ?? "—"}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statCommunity")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {stats.communitySegments}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statAudited")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {stats.segments}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statLeyFail")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {stats.heroPct}%
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-muted">{t("figuresNote")}</p>
        </section>

        <section aria-labelledby="press-contact-heading">
          <h2
            id="press-contact-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("contactHeading")}
          </h2>
          <ul className="mt-3 space-y-2 text-[13px] text-ink">
            <li>
              <a
                href={MUNICIPALITY.contactUrl}
                className="underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("contactIssues")}
              </a>
            </li>
            <li>
              <a
                href={GITHUB_URL}
                className="underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("contactGithub")}
              </a>
            </li>
            <li>
              <a
                href={CUSP_URL}
                className="underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("contactCusp")}
              </a>
            </li>
            <li>
              <a
                href={AUTHOR_LINKEDIN}
                className="underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("contactAuthor")}
              </a>
            </li>
          </ul>
        </section>

        <section aria-labelledby="press-assets-heading">
          <h2
            id="press-assets-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("assetsHeading")}
          </h2>
          <p className="mt-2 text-[13px] text-ink-muted">{t("assetsLead")}</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <a
              href={MUNICIPALITY.brandMarkLight}
              download
              className="flex flex-col items-center gap-2 rounded-[6px] border border-border bg-surface-elevated p-4 hover:border-border-strong"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG brand download */}
              <img
                src={MUNICIPALITY.brandMarkLight}
                alt={t("markLightAlt")}
                width={64}
                height={64}
              />
              <span className="text-[12px] text-ink-muted">{t("markLight")}</span>
            </a>
            <a
              href={MUNICIPALITY.brandMarkDark}
              download
              className="flex flex-col items-center gap-2 rounded-[6px] border border-border bg-ink p-4 hover:border-border-strong"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG brand download */}
              <img
                src={MUNICIPALITY.brandMarkDark}
                alt={t("markDarkAlt")}
                width={64}
                height={64}
              />
              <span className="text-[12px] text-surface/80">{t("markDark")}</span>
            </a>
            <a
              href={MUNICIPALITY.pressHero}
              download
              className="col-span-2 flex flex-col items-center gap-2 rounded-[6px] border border-border bg-surface-elevated p-4 hover:border-border-strong sm:col-span-1"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG atlas download */}
              <img
                src={MUNICIPALITY.pressHero}
                alt={t("atlasAlt")}
                width={160}
                height={90}
                className="h-auto w-full max-w-[160px] object-contain"
              />
              <span className="text-[12px] text-ink-muted">{t("atlas")}</span>
            </a>
          </div>
        </section>
      </article>
    </CivicChrome>
  );
}
