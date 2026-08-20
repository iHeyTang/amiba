/**
 * Teach `@amiba/i18n` this package's key union — TYPE ONLY.
 *
 * `MessageKey` used to be `keyof typeof en` in `@amiba/i18n` itself. With the
 * dictionaries moved to their owners that union has to travel the other way,
 * and it travels the way upstream's own `LocaleNamespaceMap` and `SlotMap` do:
 * declaration merging. `packages/ui/src/index.ts` carries a bare
 * `import type {} from "./locales/keys"` so any program that resolves
 * `@amiba/ui` gets the merge, and because BOTH the import there and the import
 * below are `import type`, nothing survives to the emitted JavaScript — the
 * entry-point separation this file sits next to is not weakened by it.
 *
 * The proof that it is erased is mechanical rather than argued: the bundle
 * purity assertion in `scripts/verify-dsh-architecture.mjs` reads the built
 * plugin `lib/client.js` and fails if a sentinel string from `./en.ts`
 * appears in a plugin that owns no Amiba copy.
 */
import type { UiMessageKey } from "./en";

declare module "@amiba/i18n" {
  interface AmibaMessages extends Record<UiMessageKey, string> {}
}

export {};
