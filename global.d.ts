import type { routing } from "@/i18n/routing";
import type en from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof en;
  }
}

declare global {
  /**
   * TypeScript 5.9's `lib.dom` ships `FileSystemDirectoryHandle` without its
   * async iteration methods, even though they are in the spec and shipped in
   * every engine that has OPFS at all. The live recorder needs `values()` to
   * scan for an unfinished session on load (`components/capture/engine/opfs.ts`).
   *
   * Declaring only what we use, and only the shape the spec defines. Drop this
   * block once lib.dom carries them.
   */
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    keys(): AsyncIterableIterator<string>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}
