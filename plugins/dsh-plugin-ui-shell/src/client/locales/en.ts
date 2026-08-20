/**
 * The app-shell's own English copy: strings rendered by
 * `product-shell.tsx`, which is this plugin's component rather than a
 * `@amiba/ui` one.
 *
 * Merged with `@amiba/ui/locales` and registered as ONE official namespace by
 * `./messages.ts`.
 */
export const en = {
  "app.initializing": "Waking your local agent",
} as const;

/** Every key the shell's own copy defines. */
export type ShellMessageKey = keyof typeof en;
/** Both-language parity, compile-enforced. */
export type ShellMessages = Record<ShellMessageKey, string>;
