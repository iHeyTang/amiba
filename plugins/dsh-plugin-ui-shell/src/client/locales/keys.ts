/**
 * Teach `@amiba/i18n` the shell's own key union — TYPE ONLY, the same
 * declaration-merging contract `@amiba/ui/locales/keys.ts` documents. Without
 * it `product-shell.tsx`'s `t("app.initializing")` would not compile, because
 * `MessageKey` is the union of exactly the owners a program can see.
 */
import type { ShellMessageKey } from "./en.js";

declare module "@amiba/i18n" {
  interface AmibaMessages extends Record<ShellMessageKey, string> {}
}

export {};
