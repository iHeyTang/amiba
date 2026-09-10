/** Bind Amiba's language mirror to the official DSH locale authority. */
import {
  installOfficialLocale,
  type OfficialLocaleId,
  type OfficialLocaleSource,
} from "@amiba/i18n";
// Type home for the official locale vocabulary. `import type` is erased, so
// nothing crosses the client-bundle purity gate (cross-plugin collaboration
// runs through the cordis service, resolved from `ctx` by the caller); the
// merge also brings `Context.locale` into scope, which is how `apply` reaches
// the runtime without an untyped `ctx.get`.
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { LocaleId, LocaleSettings } from "@deepseek-ai/dsh-client-locale/client";
import type { LOCALE_SETTINGS_NAMESPACE as UpstreamLocaleNamespace } from "@deepseek-ai/dsh-client-locale";

/** Mutual assignability of two types (`true` only when each accepts the other). */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fails to compile the moment any member of the probe table is not `true`. */
type AssertAllTrue<T extends Record<string, true>> = T;

/**
 * Proof that Amiba's structurally-restated locale vocabulary IS upstream's.
 * `@amiba/i18n` cannot import `@deepseek-ai/*` (Quick-Ask and the browser
 * surfaces consume it without a DSH graph), so the union is written out there
 * and tied to the official one here — the one package that already carries the
 * dependency. Exported so it stays on the declaration graph.
 */
export type OfficialLocaleIdMatchesUpstream = AssertAllTrue<{
  /** `"zh" | "en"` on both sides — the domain `setLocale` accepts. */
  ids: Mutual<OfficialLocaleId, LocaleId>;
  /** The durable field carries the same domain, so an adopted value is a valid id. */
  preference: Mutual<NonNullable<LocaleSettings["preference"]>, LocaleId>;
}>;

/**
 * The official settings namespace owning the durable locale selection, as
 * `dsh-client-locale` declares it (`LOCALE_SETTINGS_NAMESPACE`,
 * `lib/types/locale-settings.d.ts:4`). Restated as a literal rather than
 * imported as a value — a value import would pull the plugin's own module into
 * this client bundle — but annotated with upstream's own const type, so a
 * rename upstream is a compile error here.
 */
const LOCALE_SETTINGS_NAMESPACE: typeof UpstreamLocaleNamespace = "locale";

/** The members of the official `LocaleRuntime` this bridge uses. */
export interface OfficialLocaleRuntime extends OfficialLocaleSource {
  /** Switch the active locale — the only user-preference write entry. */
  setLocale(id: string): void;
}

export interface LocaleBridgeOptions {
  locale: OfficialLocaleRuntime;
}

/** Returns a disposer restoring browser-derived language resolution. */
export function connectOfficialLocale({ locale }: LocaleBridgeOptions): () => void {
  return installOfficialLocale(locale);
}

export { LOCALE_SETTINGS_NAMESPACE };
