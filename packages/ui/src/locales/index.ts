/**
 * `@amiba/ui/locales` — this package's own message catalogs.
 *
 * A SEPARATE ENTRY POINT from `@amiba/ui`, and that separation is the point.
 * `@amiba/ui`'s components are inlined into ten DSH client plugin bundles; if
 * the dictionary were reachable from the same module graph as the components,
 * every one of those bundles would carry all ~82 KB of it again and the split
 * would buy nothing. Only two kinds of consumer import this:
 *
 *  - `@amiba/dsh-plugin-ui-shell`, which merges it with its own copy and
 *    registers the result with the OFFICIAL locale service under one
 *    namespace, for the whole renderer;
 *  - the Electron windows that boot no DSH plugin graph (Quick-Ask, the
 *    notifier), which have no service to register with and install the
 *    catalogs directly.
 *
 * `./keys.ts` is the third file here and it is type-only: it teaches
 * `@amiba/i18n` which keys exist, so `t("…")` stays typo-checked at every call
 * site without any component importing a string.
 */
export { en, type UiMessageKey, type UiMessages } from "./en";
export { zhCN } from "./zh-CN";
