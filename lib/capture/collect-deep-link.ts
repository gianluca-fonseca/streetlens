/**
 * Parse /collect deep-link query parameters.
 */

export type CollectDeepLink = Readonly<{
  source: string | null;
  spotId: string | null;
  isQr: boolean;
}>;

const SPOT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function parseCollectDeepLink(
  searchParams: URLSearchParams | Readonly<Record<string, string | string[] | undefined>>,
): CollectDeepLink {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    const raw = searchParams[key];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw ?? null;
  };

  const source = get("src") ?? get("source");
  const spotRaw = get("spot") ?? get("street");
  const spotId = spotRaw && SPOT_ID_RE.test(spotRaw) ? spotRaw : null;

  return {
    source,
    spotId,
    isQr: source === "qr" && spotId !== null,
  };
}

export const QR_WELCOME_SEEN_KEY = "streetlens-qr-welcome-seen";

export function hasSeenQrWelcome(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(QR_WELCOME_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markQrWelcomeSeen(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QR_WELCOME_SEEN_KEY, "1");
  } catch {
    // non-fatal
  }
}

export function collectDeepLinkUrl(spotId: string, locale: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/${locale}/collect?src=qr&spot=${encodeURIComponent(spotId)}`;
}
