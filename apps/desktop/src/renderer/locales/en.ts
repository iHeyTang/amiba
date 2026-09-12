/**
 * English copy owned by the Electron windows that boot NO DSH plugin graph:
 * Quick-Ask. Nothing in the main window renders
 * these keys, so they are not part of the namespace the shell registers with
 * the official locale service — there is no occupant of that realm that could
 * ask for them, and a plugin importing an Electron app to reach them would
 * invert the dependency direction.
 *
 * These windows are the documented runtime-less case: they import
 * `@amiba/ui/locales` plus this file and install the pair as the realm's
 * message catalog before their first render.
 */
export const en = {

  // Quick-Ask window
  "quickAsk.actions.newConversation": "New conversation",
  "quickAsk.actions.openInMain": "Open in main window",
} as const;

/** Every key the Electron windows' own copy defines. */
export type DesktopMessageKey = keyof typeof en;
/** Both-language parity, compile-enforced. */
export type DesktopMessages = Record<DesktopMessageKey, string>;
