import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono, Newsreader } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Display + UI/body (single app-wide typeface, variable axis 300–700)
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

// Numeric readouts, scores, coordinates
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Serif body/prose voice for the manifesto (Field Manifesto rev 5). Wired only —
// applied to surfaces by u15. NEVER touches a headline (hard rule). opsz axis is
// automatic on the variable face; 400/500 + italics cover body, lead, sidenotes.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

// Cover the full device so `env(safe-area-inset-*)` resolves on notched phones;
// the app chrome pads itself back off the notch / home bar via the safe-area
// helpers in globals.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${spaceGrotesk.variable} ${plexMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex h-dvh-safe flex-col overflow-hidden font-sans">
        {/* Mark the document JS-enabled before paint so the section-reveal hidden
            pre-state applies only when JS can reveal it (research §3 JS-off rule). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js-enabled')",
          }}
        />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
