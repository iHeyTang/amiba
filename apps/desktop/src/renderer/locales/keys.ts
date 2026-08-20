/**
 * Teach `@amiba/i18n` the Electron windows' own key union — TYPE ONLY, the
 * same declaration-merging contract `@amiba/ui/locales/keys.ts` documents.
 * Without it `NotifierView`'s `t("notifier.chat.open")` would not compile,
 * because `MessageKey` is the union of exactly the owners a program can see.
 */
import type { DesktopMessageKey } from "./en";

declare module "@amiba/i18n" {
  interface AmibaMessages extends Record<DesktopMessageKey, string> {}
}

export {};
