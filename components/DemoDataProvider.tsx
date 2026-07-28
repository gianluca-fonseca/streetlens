"use client";

import { createContext, useContext } from "react";

/**
 * Carries the effective demo-data flag, resolved once on the server (locale
 * layout, via `demoDataEnabled()`), down to every client component.
 *
 * Client components must read `useDemoData()` and never `showDemoData()`: the
 * env var is a build-time constant inlined into the client bundle, so a client
 * read would miss the cookie override and the two halves of the page would
 * disagree about which era they are in.
 */
const DemoDataContext = createContext<boolean | null>(null);

export default function DemoDataProvider({
  value,
  children,
}: Readonly<{
  value: boolean;
  children: React.ReactNode;
}>) {
  return (
    <DemoDataContext.Provider value={value}>{children}</DemoDataContext.Provider>
  );
}

/** The effective demo-data flag. Throws outside the provider so a missing wire is loud. */
export function useDemoData(): boolean {
  const value = useContext(DemoDataContext);
  if (value === null) {
    throw new Error("useDemoData must be used inside <DemoDataProvider>");
  }
  return value;
}
