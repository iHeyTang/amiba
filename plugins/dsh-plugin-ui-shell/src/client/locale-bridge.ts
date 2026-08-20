/**
 * The OFFICIAL locale service is Amiba's single language authority.
 *
 * Two jobs, both of them adapter code around
 * `@deepseek-ai/dsh-client-locale`:
 *
 *  1. **Authority.** `@amiba/i18n` subscribes to the official `LocaleRuntime`
 *     (`getSnapshot` + `subscribe`, the same LocaleFace pair the framework's
 *     own `t` seat consumes through `ctx.slots.installLocale`), so Amiba's
 *     447-key catalog and the official/plugin copy switch together, in the
 *     same tick, with no reload.
 *  2. **Migration.** Amiba used to persist its own `settings.ui.language`
 *     tri-state and drew its own 语言 row. That row is gone; a user who had
 *     already chosen `en` or `zh-CN` there is carried over to the official
 *     service ONCE, and only while the official service has no durable
 *     selection of its own.
 *
 * ## Id mapping
 *
 * The two axes do not share vocabulary: official ships `zh` and `en`
 * (`LOCALE_IDS`), Amiba's catalogs are keyed `zh-CN` and `en`.
 * `setLocale` THROWS on an unregistered id, so `zh-CN` must never reach it —
 * the mapping lives in `@amiba/i18n` (`toOfficialLocaleId` /
 * `fromOfficialLocaleId`) and `toOfficialLocaleId`'s return type is the
 * official union, which is what makes the leak a compile error rather than a
 * runtime throw. {@link OfficialLocaleIdMatchesUpstream} below ties that
 * hand-written union back to upstream's own `LocaleId`.
 */

import {
  installOfficialLocale,
  loadLanguagePreference,
  markLanguagePreferenceMigrated,
  toOfficialLocaleId,
  type LanguagePreference,
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
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";

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
  /** The official locale service (`ctx.locale`). */
  locale: OfficialLocaleRuntime;
  /** The official durable locale section (`ctx.settingsScope.bind`). */
  localeSettings: SettingsScope<LocaleSettings>;
  /** Seam for tests; defaults to the retired Amiba preference. */
  loadPreference?: () => Promise<LanguagePreference>;
  /** Seam for tests; defaults to stamping the retired key back to `auto`. */
  markMigrated?: () => Promise<void>;
  /** Reported rather than thrown — a migration must never break boot. */
  onError?: (error: unknown) => void;
}

/**
 * Bind `@amiba/i18n` to the official locale service and run the one-time
 * migration.
 *
 * @returns a disposer restoring the no-runtime language resolution.
 */
export function connectOfficialLocale(options: LocaleBridgeOptions): () => void {
  const disposeAuthority = installOfficialLocale(options.locale);
  const disposeMigration = migrateLegacyLanguagePreference(options);
  return () => {
    disposeMigration();
    disposeAuthority();
  };
}

/**
 * Carry a pre-existing Amiba language choice over to the official service,
 * exactly once.
 *
 * ## How "never chosen" is determined
 *
 * From the official durable section itself, not from the active locale. The
 * active locale cannot answer the question — while nothing is chosen it
 * already equals the browser-derived provisional value, so "active is en" is
 * indistinguishable from "the user picked en".
 *
 * The section, in contrast, is explicit: `LocaleSettings.preference` is
 * documented as "explicit locale selection; absence delegates to the browser",
 * `setLocale` is the only writer, and upstream's own `adopt` reads
 * `section.preference ?? this.provisional`. So an ABSENT `preference` on a
 * `ready` snapshot is precisely "the official service has nothing to say" —
 * the state Amiba's retired `auto` also meant. There is no fallback VALUE to
 * confuse with absence (the field's domain is `"zh" | "en"`, never `"auto"`),
 * so the two cases are distinguishable and no guess is involved.
 *
 * Three guards, each buying something specific:
 *
 *  - `status !== "ready"` — `loading` means "not known yet", not "never
 *    chosen". Acting on it would race the Host read and could overwrite a real
 *    selection with the retired one.
 *  - `!writable` — memory mode / a namespace not exposed to this client. The
 *    write could not persist, so flipping the language and stamping the marker
 *    would move the user once and lose the choice at the next launch. Nothing
 *    is written and nothing is marked, so a later writable session still
 *    migrates.
 *  - `value?.preference !== undefined` — somebody already named a locale.
 *    Official wins; the migration retires itself.
 */
export function migrateLegacyLanguagePreference({
  locale,
  localeSettings,
  loadPreference = loadLanguagePreference,
  markMigrated = markLanguagePreferenceMigrated,
  onError,
}: LocaleBridgeOptions): () => void {
  let settled = false;
  let unsubscribe: (() => void) | null = null;

  const retire = (): void => {
    settled = true;
    unsubscribe?.();
    unsubscribe = null;
  };

  void loadPreference()
    .then((preference) => {
      if (settled) return;
      // `auto` maps onto the official "never chosen" state — same behaviour,
      // nothing to carry over.
      if (preference === "auto") return;
      const target = toOfficialLocaleId(preference);
      const attempt = (): void => {
        if (settled) return;
        const snapshot = localeSettings.getSnapshot();
        if (snapshot.status !== "ready") return;
        if (!snapshot.writable) {
          retire();
          return;
        }
        if (snapshot.value?.preference !== undefined) {
          retire();
          return;
        }
        retire();
        try {
          locale.setLocale(target);
        } catch (error) {
          onError?.(error);
          return;
        }
        void markMigrated().catch((error: unknown) => onError?.(error));
      };
      unsubscribe = localeSettings.subscribe(attempt);
      attempt();
    })
    .catch((error: unknown) => onError?.(error));

  return retire;
}

export { LOCALE_SETTINGS_NAMESPACE };
