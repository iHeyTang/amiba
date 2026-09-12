/**
 * The message catalog for the Electron windows that boot NO DSH plugin graph:
 * Quick-Ask.
 *
 * Those windows render `@amiba/ui` components, whose `useT()` calls resolve
 * through the realm message registry like everyone else's — but there is no
 * `ctx.locale` in their realm to register a namespace with, so nothing else
 * would ever fill that registry. They are the documented runtime-less case,
 * and they are the ONE place outside `@amiba/dsh-plugin-ui-shell` that
 * legitimately imports a dictionary: `@amiba/ui/locales` for the components'
 * copy, plus this package's own window copy.
 *
 * The MAIN window is deliberately not a caller. It boots the plugin graph, so
 * the shell's registration serves it, and importing the catalogs here would
 * put them in the main renderer bundle for nothing.
 */
import { installMessageCatalog, type ResolvedLanguage } from "@amiba/i18n";
import { en as uiEn, zhCN as uiZh, type UiMessageKey } from "@amiba/ui/locales";

import { en, type DesktopMessageKey } from "./en";
import { zhCN } from "./zh-CN";
import type {} from "./keys";

/** Every key a runtime-less Amiba window can render. */
export type WindowMessageKey = UiMessageKey | DesktopMessageKey;

/**
 * Both languages, both owners. The annotation makes a key present in one
 * language but missing from the other a compile error here, on top of each
 * owner's own parity check.
 */
export const windowMessages: Record<
  ResolvedLanguage,
  Record<WindowMessageKey, string>
> = {
  en: { ...uiEn, ...en },
  "zh-CN": { ...uiZh, ...zhCN },
};

/**
 * Install {@link windowMessages} as this realm's template source. Called from
 * a window entry point BEFORE its first render, next to
 * `seedDocumentLanguage()` — the two together are the whole runtime-less
 * contract: a truthful `<html lang>` and a dictionary to read.
 */
export function installWindowMessages(): () => void {
  return installMessageCatalog(windowMessages);
}
