"use client";

/**
 * useTheme — a provider-less theme store (u7).
 *
 * Backed by a module-level store read through useSyncExternalStore, so every
 * switcher on a page (there is only ever one, but this keeps them coherent and
 * SSR-safe) shares one source of truth without wrapping the root layout. The
 * pre-paint THEME_INIT_SCRIPT has already set the class before React hydrates;
 * this hook keeps it in sync on user changes and when the OS flips while the
 * preference is "system".
 */

import { useSyncExternalStore } from "react";
import {
  applyPreference,
  readStoredPreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

let preference: ThemePreference = "system";
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setPreference(next: ThemePreference) {
  preference = next;
  applyPreference(next);
  emit();
}

/** Bind the store to the DOM once, on first subscription. */
function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  preference = readStoredPreference();
  // The init script already applied the class pre-paint; re-assert so the store
  // and the DOM agree (and to normalize a stale/legacy class).
  applyPreference(preference);

  // Cross-tab sync: mirror a preference changed in another tab.
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== "streetlens-theme") return;
    const next = readStoredPreference();
    if (next !== preference) {
      preference = next;
      applyPreference(next);
      emit();
    }
  });

  // Live OS changes: when following the system, re-resolve the class in place.
  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preference === "system") {
        applyPreference("system");
        emit();
      }
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onChange); // older Safari
    }
  }
}

function subscribe(listener: () => void) {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemePreference {
  return preference;
}

// The server (and the first client render, before hydration) must agree: both
// report "system" so the switcher markup matches and there is no hydration warp.
function getServerSnapshot(): ThemePreference {
  return "system";
}

export interface UseThemeResult {
  /** The stored choice: light / dark / system. */
  preference: ThemePreference;
  /** The concrete theme currently rendering. */
  resolved: ResolvedTheme;
  /** Persist a new choice and apply it to the document. */
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): UseThemeResult {
  const pref = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return {
    preference: pref,
    resolved: resolveTheme(pref),
    setPreference,
  };
}
