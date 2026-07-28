import { cookies } from "next/headers";
import { DEMO_DATA_COOKIE, resolveDemoData } from "./demo-flag";

/**
 * The effective demo-data flag for the current request.
 *
 * Server-only: `cookies()` comes from `next/headers`, so importing this module
 * from a client component is a build error by construction. That is deliberate.
 * Client components read the value from `DemoDataProvider` instead, and the data
 * layer (`lib/segments.ts`, `lib/real-data-era.ts`) takes it as an argument, so
 * this stays the single request-time resolution point.
 *
 * Reading a cookie opts the calling route into dynamic rendering. That is the
 * price of a switch that works without a rebuild, and it is paid once, in the
 * locale layout.
 */
export async function demoDataEnabled(): Promise<boolean> {
  const store = await cookies();
  return resolveDemoData(store.get(DEMO_DATA_COOKIE)?.value);
}
