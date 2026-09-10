import { useMemo, useSyncExternalStore } from "react";

import {
  interpolate,
  messagesEpoch,
  resolveMessage,
  subscribeMessages,
  type MessageLanguage,
} from "./messages";

/**
 * Runtime i18n for Amiba UI surfaces.
 *
 * ## Who decides the language
 *
 * The OFFICIAL DSH locale service does, wherever one exists. Amiba used to
 * own a second, competing preference (`settings.ui.language`, an
 * `auto | en | zh-CN` tri-state persisted through the PlatformAdapter) with
 * its own row in Appearance settings. Once Amiba declared
 * `settings.general.item`, `@deepseek-ai/dsh-client-locale` put its own
 * Language row on the same page and the product showed TWO 语言 controls that
 * did not agree. The official one won: it is the service the whole DSH plugin
 * ecosystem's `t` seat already reads, so a second authority could only ever
 * mean "official copy and Amiba copy disagree".
 *
 * There are therefore exactly two cases, and a caller tells them apart with
 * {@link hasOfficialLocale}:
 *
 *  1. **A DSH client runtime is present.** Whoever owns the plugin context
 *     (today `@amiba/dsh-plugin-ui-shell`) calls {@link installOfficialLocale}
 *     with the official `LocaleRuntime`'s `getSnapshot`/`subscribe` pair. That
 *     source is then AUTHORITATIVE for the whole RENDERER, not just for the
 *     bundle that installed it: it is kept on the realm-wide symbol registry,
 *     so every independently-bundled copy of this module resolves the same
 *     instance and `useT` re-renders synchronously on every official switch.
 *  2. **No plugin runtime** — Quick-Ask, the notifier window, the browser
 *     surfaces. Nothing installs a source, and the language resolves from the
 *     document contract, falling back to `navigator.language`. Those entries
 *     publish that fallback once via {@link seedDocumentLanguage} so the
 *     window carries a truthful `lang` attribute from its first paint.
 *
 * ## What `document.documentElement.lang` is still for
 *
 * It is no longer the cross-bundle channel for `useT` — the realm registry
 * below is. It remains load-bearing for:
 *
 *  - the **runtime-less windows** (Quick-Ask, the notifier), which have no DSH
 *    plugin graph at all and therefore no official source to resolve;
 *  - `./plugin.ts`'s `usePluginT`, and the handful of non-React slot-label
 *    readers in the plugins, which observe the attribute directly;
 *  - `<html lang>` being CORRECT in its own right (`:lang()`, assistive tech).
 *
 * ## Where the STRINGS come from
 *
 * Not from here. This package owns the mechanism — which language is active,
 * and how a key becomes rendered text — while each dictionary lives with the
 * surface whose copy it is (`@amiba/ui/locales`, the ui-shell's own
 * `./locales`, `apps/desktop`'s window copy). They meet at runtime through
 * `./messages.ts`'s realm slot, which is what keeps the eleven plugin bundles
 * free of ~82 KB of catalog each. `useT()` never names a namespace: the shell
 * registers the merged owner dictionaries as ONE official namespace and
 * installs that namespace's bound translate, so the binding is made once, in
 * one place, and every call site stays exactly as it was.
 *
 * `useT()` returns a `t(key, params?)` function bound to the active language.
 */

export type ResolvedLanguage = MessageLanguage;

/**
 * The registry of Amiba message keys, filled by DECLARATION MERGING from each
 * dictionary owner — the same idiom upstream uses for its own
 * `LocaleNamespaceMap` and `SlotMap`, and for the same reason: the owners
 * cannot be imported from here (`apps/desktop` is an Electron app, and
 * `@amiba/ui` already depends on this package), but their key unions still
 * have to reach the 879 `t("…")` call sites.
 *
 * Each owner contributes one type-only augmentation next to its catalog:
 *
 * ```ts
 * declare module "@amiba/i18n" {
 *   interface AmibaMessages extends Record<UiMessageKey, string> {}
 * }
 * ```
 *
 * A program that has no owner in it resolves {@link MessageKey} to `never`,
 * which makes every `t("…")` in that program a compile error rather than a
 * silent widening to `string`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AmibaMessages {}

/** Every message key declared by an owner reachable from this program. */
export type MessageKey = keyof AmibaMessages & string;

/**
 * The official locale identifiers, exactly as
 * `@deepseek-ai/dsh-client-locale` ships them (`LOCALE_IDS = ["zh", "en"]`,
 * `lib/types/locale-settings.d.ts:8`). Restated structurally because this
 * package is platform-agnostic — it is imported by Quick-Ask and by browser
 * surfaces that have no `@deepseek-ai/*` dependency at all. The tie to the
 * official union is a compile-time probe in the one package that DOES have
 * that dependency: see `OfficialLocaleIdMatchesUpstream` in
 * `plugins/dsh-plugin-ui-shell/src/client/locale-bridge.ts`.
 */
export type OfficialLocaleId = "zh" | "en";

/**
 * Amiba's language tag for an official locale id. Total by construction: the
 * primary subtag decides, the same way the official plugin's own
 * `detectBrowserLocale` matches a browser tag against its shipped locales
 * (`zh-Hans-CN` -> zh, `en-GB` -> en), so an id Amiba has never seen lands on
 * English rather than throwing inside a render.
 */
export function fromOfficialLocaleId(id: string): ResolvedLanguage {
  return id.toLowerCase().split("-")[0] === "zh" ? "zh-CN" : "en";
}

/**
 * The official locale id for an Amiba language tag — the ONLY value that may
 * ever be handed to `LocaleRuntime.setLocale`, which throws on an
 * unregistered id (`locale "<id>" is not registered`). The return type is the
 * official union, so Amiba's own `zh-CN` cannot leak through this function
 * without a compile error.
 */
export function toOfficialLocaleId(language: ResolvedLanguage): OfficialLocaleId {
  return language === "zh-CN" ? "zh" : "en";
}

/**
 * Re-key a per-language table by the OFFICIAL locale ids — the shape
 * `LocaleRuntime.register(ns, dicts)` takes, since upstream's dictionary table
 * is `Record<LocaleId, …>`.
 *
 * The pairing is DERIVED, not asserted: each official id asks
 * {@link fromOfficialLocaleId} which Amiba language it names, which is exactly
 * the question a table keyed by official id poses. The literal `zh` / `en`
 * keys must exhaust {@link OfficialLocaleId} for the return type to hold, and
 * that union is tied to upstream's `LocaleId` by
 * `OfficialLocaleIdMatchesUpstream` in the ui-shell locale bridge — so a new
 * upstream locale is a compile error on both sides rather than a silently
 * unregistered language.
 */
export function toOfficialCatalog<T>(
  byLanguage: Record<ResolvedLanguage, T>,
): Record<OfficialLocaleId, T> {
  return {
    zh: byLanguage[fromOfficialLocaleId("zh")],
    en: byLanguage[fromOfficialLocaleId("en")],
  };
}

/** The half of the official `LocaleSnapshot` this package consumes. */
export interface OfficialLocaleSnapshot {
  /** Active locale id (`"zh"` or `"en"`). */
  readonly active: string;
}

/**
 * The official locale service as Amiba consumes it: structurally the
 * LocaleFace `getSnapshot`/`subscribe` pair that `LocaleRuntime` publishes
 * (and that `ctx.slots.installLocale` consumes for the framework `t` seat).
 * Amiba reads the same snapshot the UI Shell language-row shadow reads.
 */
export interface OfficialLocaleSource {
  getSnapshot(): OfficialLocaleSnapshot;
  subscribe(onChange: () => void): () => void;
}

// ---------------------------------------------------------------------------
// The language mirror
// ---------------------------------------------------------------------------

/**
 * The browser's own language, matched on the primary subtag. This is the
 * no-runtime fallback, and it is deliberately the same derivation the official
 * plugin performs for its provisional locale.
 */
export function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === "undefined") return "en";
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);
  for (const raw of candidates) {
    const tag = String(raw).toLowerCase();
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

function readDocumentLanguage(): ResolvedLanguage | null {
  if (typeof document === "undefined") return null;
  const declared = document.documentElement.lang.toLowerCase();
  if (declared.startsWith("zh")) return "zh-CN";
  if (declared.startsWith("en")) return "en";
  return null;
}

type LanguageSubscriber = (language: ResolvedLanguage) => void;

// ---------------------------------------------------------------------------
// The realm-wide official-source registry
// ---------------------------------------------------------------------------
//
// Every DSH client plugin bundle inlines its own copy of this module, so a
// module-scoped `let officialSource` could only ever be set in the ONE bundle
// whose `apply` holds the `ctx` (ui-shell's). Every other copy stayed on the
// no-runtime fallback and had to be reached through `document.documentElement
// .lang`. The source is realm-singular by nature — there is exactly one
// official `LocaleRuntime` per renderer — so it lives on the realm-wide symbol
// registry, the same way `@amiba/app-runtime/platform` shares the
// PlatformAdapter and `@amiba/ui`'s settings chrome shares its React context.
//
// ## What is global and what is deliberately NOT
//
// GLOBAL — the official source and the ONE subscription to it. State that must
// be singular for every copy to agree on the active language.
//
// NOT GLOBAL — `cachedLanguage`, `languageSubscribers`, `storeSubscribers`
// below. Each bundle copy notifies its OWN React trees and its own non-React
// observers; hoisting those sets onto the realm would make every copy's
// `useSyncExternalStore` fire for every other copy's mount, and would collapse
// N independent `useT` stores into one shared list of listeners belonging to
// whichever copy happened to load first.
//
// ## Waking copies that were already initialised
//
// A copy that loaded BEFORE `installOfficialLocale` ran has already resolved
// `cachedLanguage` from the no-runtime chain. A bare slot on the registry
// would leave it stuck there, so the registry also carries an install-
// notification list: every copy adds its own `refreshLanguage` on load, and
// installing (or disposing) a source runs all of them.

const OFFICIAL_LOCALE_KEY = Symbol.for("@amiba/i18n/official-locale");

interface OfficialLocaleRegistry {
  /** The realm's one official locale service; null until a `ctx` owner installs. */
  source: OfficialLocaleSource | null;
  /** Disposer for the registry's single subscription to `source`. */
  unsubscribe: (() => void) | null;
  /** One `refreshLanguage` per bundled copy of this module. */
  readonly observers: Set<() => void>;
}

function officialLocaleRegistry(): OfficialLocaleRegistry {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[OFFICIAL_LOCALE_KEY] as
    | OfficialLocaleRegistry
    | undefined;
  if (existing) return existing;
  const created: OfficialLocaleRegistry = {
    source: null,
    unsubscribe: null,
    observers: new Set(),
  };
  realm[OFFICIAL_LOCALE_KEY] = created;
  return created;
}

/** Wake every bundle copy in this realm — the install-notification fan-out. */
function notifyRealm(): void {
  for (const observer of [...officialLocaleRegistry().observers]) observer();
}

const languageSubscribers = new Set<LanguageSubscriber>();
const storeSubscribers = new Set<() => void>();

function resolveActiveLanguage(): ResolvedLanguage {
  const source = officialLocaleRegistry().source;
  if (source) return fromOfficialLocaleId(source.getSnapshot().active);
  return readDocumentLanguage() ?? detectBrowserLanguage();
}

let cachedLanguage: ResolvedLanguage = resolveActiveLanguage();
let cachedMessagesEpoch: number = messagesEpoch();

/**
 * This copy's `useSyncExternalStore` snapshot: the active language AND the
 * realm's message-registry revision, joined.
 *
 * The epoch belongs in the snapshot because the dictionary can arrive AFTER
 * the first paint — the shell registers its namespace inside
 * `ctx.inject(["locale"], …)`, which resolves whenever the service does. A
 * snapshot carrying only the language would be `Object.is`-equal across that
 * install and React would bail out of the re-render, leaving already-mounted
 * trees showing raw keys forever.
 */
type LanguageStoreSnapshot = `${ResolvedLanguage}#${number}`;

function composeStoreSnapshot(
  language: ResolvedLanguage,
  epoch: number,
): LanguageStoreSnapshot {
  return `${language}#${epoch}`;
}

/**
 * The language half of a snapshot. Total and cast-free — the primary subtag
 * decides, exactly as {@link fromOfficialLocaleId} does.
 */
function languageOfStoreSnapshot(
  snapshot: LanguageStoreSnapshot,
): ResolvedLanguage {
  return snapshot.startsWith("zh") ? "zh-CN" : "en";
}

let storeSnapshot: LanguageStoreSnapshot = composeStoreSnapshot(
  cachedLanguage,
  cachedMessagesEpoch,
);

function publishDocumentLanguage(language: ResolvedLanguage): void {
  if (typeof document === "undefined") return;
  if (document.documentElement.lang === language) return;
  document.documentElement.lang = language;
}

function refreshLanguage(): void {
  // `<html lang>` is no longer how the official switch reaches the other
  // bundles — the registry is — but it stays truthful for the surfaces that
  // still read the attribute directly (see the header doc block).
  if (officialLocaleRegistry().source) {
    publishDocumentLanguage(resolveActiveLanguage());
  }
  const next = resolveActiveLanguage();
  const nextEpoch = messagesEpoch();
  if (next === cachedLanguage && nextEpoch === cachedMessagesEpoch) return;
  const languageChanged = next !== cachedLanguage;
  cachedLanguage = next;
  cachedMessagesEpoch = nextEpoch;
  storeSnapshot = composeStoreSnapshot(next, nextEpoch);
  for (const listener of [...storeSubscribers]) listener();
  // A dictionary arriving is not a language change: `subscribeLanguage`
  // observers are told about the LANGUAGE and must not see a spurious
  // notification carrying the value they already hold.
  if (languageChanged) {
    for (const listener of [...languageSubscribers]) listener(next);
  }
}

// This copy joins the realm's install-notification list at load, so a source
// installed later by ANY bundle wakes it, and a source installed earlier is
// already visible through `resolveActiveLanguage` above.
officialLocaleRegistry().observers.add(refreshLanguage);
// The same for the dictionary: a catalog or namespace binding installed by
// ANY bundle after this copy loaded must repaint this copy's trees.
subscribeMessages(refreshLanguage);

// Started eagerly, not on first subscription: a realm whose document language
// is published before its first `useT` mount would otherwise render one frame
// of a stale snapshot.
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver(refreshLanguage).observe(document.documentElement, {
    attributeFilter: ["lang"],
    attributes: true,
  });
}

/** True when this REALM holds the official locale source (case 1 of the two). */
export function hasOfficialLocale(): boolean {
  return officialLocaleRegistry().source !== null;
}

/**
 * Adopt the official DSH locale service as the authority for Amiba's own UI
 * copy. Called once per REALM by whoever owns a DSH client context; every
 * bundled copy of this module in that realm follows, including the copies
 * that finished loading before the call. The returned disposer restores the
 * no-runtime resolution for all of them.
 */
export function installOfficialLocale(
  source: OfficialLocaleSource,
): () => void {
  const registry = officialLocaleRegistry();
  registry.unsubscribe?.();
  registry.source = source;
  // ONE subscription for the whole realm, fanned out to every copy.
  registry.unsubscribe = source.subscribe(notifyRealm);
  notifyRealm();
  return () => {
    if (registry.source !== source) return;
    registry.unsubscribe?.();
    registry.unsubscribe = null;
    registry.source = null;
    notifyRealm();
  };
}

/**
 * Publish the no-runtime fallback into the document contract. Entry points of
 * windows that never boot a DSH plugin graph (Quick-Ask, the notifier) call
 * this before mounting so their `<html lang>` stops being the index.html
 * literal. A no-op once an official source is installed.
 */
export function seedDocumentLanguage(): ResolvedLanguage {
  if (!officialLocaleRegistry().source) {
    publishDocumentLanguage(detectBrowserLanguage());
  }
  refreshLanguage();
  return cachedLanguage;
}

/** The active language, outside React. */
export function getCurrentLanguage(): ResolvedLanguage {
  return cachedLanguage;
}

/** Observe the active language, outside React. */
export function subscribeLanguage(cb: LanguageSubscriber): () => void {
  languageSubscribers.add(cb);
  return () => {
    languageSubscribers.delete(cb);
  };
}

function subscribeLanguageStore(onStoreChange: () => void): () => void {
  storeSubscribers.add(onStoreChange);
  return () => {
    storeSubscribers.delete(onStoreChange);
  };
}

function languageStoreSnapshot(): LanguageStoreSnapshot {
  return storeSnapshot;
}

export type TranslateFn = (
  key: MessageKey,
  params?: Record<string, unknown>,
) => string;

/**
 * The one translation hook for Amiba's own surfaces. It takes NO namespace:
 * the shell registers every owner's dictionary as a single official namespace
 * and installs that namespace's bound translate into the realm, so the binding
 * is made once rather than at each of the 879 call sites.
 */
export function useT(): {
  t: TranslateFn;
  language: ResolvedLanguage;
} {
  const snapshot = useSyncExternalStore(
    subscribeLanguageStore,
    languageStoreSnapshot,
    languageStoreSnapshot,
  );
  const language = languageOfStoreSnapshot(snapshot);

  const t = useMemo<TranslateFn>(
    () => (key, params) => interpolate(resolveMessage(key, language), params),
    // `snapshot` is the dep that matters: it advances on a language switch AND
    // on a dictionary install, and `language` is derived from it.
    [snapshot, language],
  );

  return { t, language };
}

export {
  hasMessages,
  installMessageCatalog,
  installMessages,
  messagesEpoch,
  resolveMessage,
  type MessageCatalog,
  type MessageResolver,
} from "./messages";
