/**
 * On-demand ISR invalidation for map + landing after an admin approval.
 * Timed revalidate=300 remains the backstop.
 */

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

/** Revalidate every localized map, landing, and insights route. */
export function revalidatePublicMapPages(): void {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/map`);
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/insights`);
  }
}
