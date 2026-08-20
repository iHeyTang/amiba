/**
 * Amiba's product copy, as ONE official locale namespace.
 *
 * ## Why one namespace, registered here
 *
 * `LocaleRuntime.register` binds a namespace to a single owner — upstream is
 * explicit that a duplicate `(ns, locale)` throws, "single occupant; a
 * namespace's texts have one owner". Amiba's `useT()` takes no namespace and
 * its call sites span three owners (`@amiba/ui`, this plugin, and the Electron
 * windows), so per-owner namespaces would need `useT` to walk a lookup chain
 * Amiba invented on top of upstream's. Instead the OWNERS keep their
 * dictionaries and the REGISTRATION is central: this module merges them and
 * registers the result once, under {@link AMIBA_LOCALE_NS}. One namespace, one
 * owner, upstream's rule satisfied literally — and not one of the 879
 * `t("…")` call sites had to change.
 *
 * ## Two installs, in this order, and why both
 *
 * 1. {@link installAmibaMessageCatalog} — the compile-time catalogs, installed
 *    unconditionally from `apply`. `ctx.locale` is optional in this
 *    composition (the shell's `ctx.inject(["locale"], …)` guard exists because
 *    the product shell must mount whether or not the locale row is in the
 *    graph). Without this first install a composition missing
 *    `@deepseek-ai/dsh-client-locale` would render every Amiba string as its
 *    raw dotted key. It is the same runtime-less path Quick-Ask takes, applied
 *    to a realm where the service happens to be absent — not a second
 *    mechanism.
 * 2. {@link registerAmibaMessages} — the official registration plus the bound
 *    translate, installed on top once `locale` resolves. `installMessages`
 *    supersedes, and its disposer restores step 1, so a disposed locale fiber
 *    falls back to the catalogs rather than to nothing.
 */
import {
  installMessageCatalog,
  installMessages,
  toOfficialCatalog,
  type ResolvedLanguage,
} from "@amiba/i18n";
import { en as uiEn, zhCN as uiZh, type UiMessageKey } from "@amiba/ui/locales";
// Type homes. `import type` is erased, so neither the locale plugin's module
// nor the slot registry's crosses the client-bundle purity gate; the
// augmentation below merges into `LocaleNamespaceMap` exactly the way
// upstream's own dictionary owners do.
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";

import {
  en as shellEn,
  zhCN as shellZh,
  type ShellMessageKey,
} from "./locales/index.js";
import type {} from "./locales/keys.js";

/**
 * The namespace. One string, one owner, one registration site — the whole
 * point of this module.
 */
export const AMIBA_LOCALE_NS = "amiba";

/**
 * The namespace's dictionary key union: the UI components' copy plus the
 * shell's own. The Electron windows' 9 keys are deliberately absent — they
 * belong to windows that boot no plugin graph, nothing in this realm can ask
 * for them, and reaching them would mean a plugin importing an Electron app.
 */
export type AmibaLocaleKey = UiMessageKey | ShellMessageKey;

/**
 * Every Amiba string this realm can render, in both languages.
 *
 * The annotation is load-bearing: it makes a key present in one owner but
 * missing from the other language a compile error HERE, on top of each
 * owner's own `Record<OwnKey, string>` parity check and on top of the typed
 * `register` overload below. Three independent checks, none of them a lint.
 */
export const amibaMessages: Record<
  ResolvedLanguage,
  Record<AmibaLocaleKey, string>
> = {
  en: { ...uiEn, ...shellEn },
  "zh-CN": { ...uiZh, ...shellZh },
};

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** Amiba's own product copy: the UI components' and the shell's. */
    amiba: AmibaLocaleKey;
  }
}

/** The members of the official `LocaleRuntime` this module needs. */
export type AmibaLocaleRegistrar = Pick<LocaleRuntime, "register" | "bind">;

/** The compile-time fallback (step 1 of the header). Returns a disposer. */
export function installAmibaMessageCatalog(): () => void {
  return installMessageCatalog(amibaMessages);
}

/**
 * Register the namespace with the official locale service and make its bound
 * translate the realm's template source (step 2 of the header).
 *
 * `register` is the TYPED overload: upstream checks the dictionary against the
 * namespace's declared key union (a missing or extra key is a compile error)
 * and requires every shipped locale, so bilingual balance is enforced at the
 * registration site as well as at each owner's catalog.
 *
 * `bind` is reached through a `string`-typed namespace on purpose. That
 * selects upstream's UNTYPED `bind(ns: string): Translate` overload, whose key
 * domain — any string — is the one this call site actually has: the realm
 * resolver is handed every key any Amiba surface asks for, including the
 * plugin-local keys `usePluginT` is SUPPOSED to miss on before falling through
 * to its own overlay's English. Upstream answers a miss with the key itself,
 * which is exactly what `useT` has always rendered for an unknown key.
 *
 * @returns a disposer removing the registration and restoring the catalogs.
 */
export function registerAmibaMessages(locale: AmibaLocaleRegistrar): () => void {
  const disposeRegistration = locale.register(
    AMIBA_LOCALE_NS,
    toOfficialCatalog(amibaMessages),
  );
  const untypedNamespace: string = AMIBA_LOCALE_NS;
  const translate = locale.bind(untypedNamespace);
  const disposeResolver = installMessages((key) => translate(key));
  return () => {
    disposeResolver();
    disposeRegistration();
  };
}
