import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// Placeholder landing — the full "Civic Atlas" marketing page is assembled in
// this unit (hero, gap, four lenses, method, grounding, FAQ, CTA, footer).
export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col items-start justify-center gap-4 px-6 py-24">
        <p className="font-display text-2xl font-semibold text-ink">StreetLens</p>
        <Link
          href="/map"
          className="rounded-[8px] bg-pine px-4 py-2 text-[0.95rem] font-medium text-surface-elevated"
        >
          Explore the map
        </Link>
      </div>
    </main>
  );
}
