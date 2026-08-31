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
  "shell.ask.action": "Ask the user",
  "shell.ask.waiting": "Waiting for answers…",
  "shell.ask.answered": "{answered}/{total} answered",
  "shell.ask.cancelled": "Dismissed by the user",
  "shell.ask.skipped": "Not answered",
} as const;

/** Every key the shell's own copy defines. */
export type ShellMessageKey = keyof typeof en;
/** Both-language parity, compile-enforced. */
export type ShellMessages = Record<ShellMessageKey, string>;
