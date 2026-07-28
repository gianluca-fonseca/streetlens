"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  DEMO_DATA_COOKIE,
  DEMO_DATA_COOKIE_MAX_AGE,
  DEMO_DATA_OFF,
  DEMO_DATA_ON,
} from "./demo-flag";

/**
 * Flip the demo era for this browser and re-render the tree that depends on it.
 *
 * The cookie is httpOnly: nothing client-side reads it, since the resolved value
 * already travels down through `DemoDataProvider`. Path `/` so the whole site
 * agrees, SameSite=Lax so a normal link into the site keeps the setting, and a
 * one-year lifetime so a demo link survives a stakeholder's week.
 */
export async function setDemoData(enabled: boolean): Promise<void> {
  const store = await cookies();
  store.set(DEMO_DATA_COOKIE, enabled ? DEMO_DATA_ON : DEMO_DATA_OFF, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: DEMO_DATA_COOKIE_MAX_AGE,
  });
  // The locale layout is where the flag is resolved, so invalidating it takes
  // every page under it with it.
  revalidatePath("/[locale]", "layout");
}
