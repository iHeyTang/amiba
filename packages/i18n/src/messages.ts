/**
 * Where Amiba's message TEMPLATES come from, at runtime, for every bundled
 * copy of this package in one renderer.
 *
 * ## Why this is not a compile-time table any more
 *
 * `en.ts` / `zh-CN.ts` used to live here and every consumer imported them, so
 * all eleven DSH client plugin bundles inlined the complete 498-key catalog in
 * both languages (~82 KB each) — including `dsh-plugin-runtime-inventory`,
 * which renders no `useT` copy at all. The dictionaries now live with their
 * OWNERS (`@amiba/ui/locales`, the ui-shell's own `./locales`, and
 * `apps/desktop`'s window copy) and reach this package at RUNTIME, through the
 * realm below. A plugin bundle that renders Amiba UI therefore carries the
 * COMPONENTS but not the copy.
 *
 * ## The realm slot
 *
 * There is exactly one message source per renderer, and every bundled copy of
 * `@amiba/i18n` must resolve the same one — the same argument that puts the
 * official locale SOURCE on the realm registry in `./index.ts`. It is a
 * separate slot from that one because the two facts are separate and have
 * different installers: which language is active (the official `LocaleFace`)
 * versus where the templates come from. Quick-Ask installs the second without
 * the first.
 *
 * Two installers exist, and they are the same two cases `./index.ts`
 * documents:
 *
 *  1. **A DSH client runtime is present.** `@amiba/dsh-plugin-ui-shell`
 *     registers the merged owner dictionaries with the OFFICIAL locale
 *     service under one namespace (`ctx.locale.register`) and installs that
 *     namespace's bound translate as the resolver. Lookup, fallback and
 *     missing-key behaviour are then upstream's.
 *  2. **No plugin runtime** — Quick-Ask, the notifier. Those entries import
 *     their owners' dictionaries directly and install a plain catalog
 *     resolver. This is the documented runtime-less case, not a second
 *     mechanism: the shell uses it too while `ctx.locale` is unavailable, so
 *     a composition without `@deepseek-ai/dsh-client-locale` still renders
 *     real copy rather than raw dotted keys.
 *
 * ## What is realm-wide here, and why that is safe
 *
 * `resolve`, `epoch` and `observers` are ALL realm-wide. That is deliberately
 * different from `./index.ts`, where the per-copy language cache and its two
 * subscriber sets must stay module-scoped: there, every copy's
 * `refreshLanguage` walks its own list, so a shared list would notify each
 * listener once PER COPY. Here there is exactly one publisher — an install or
 * a dispose — which bumps the epoch once and walks the observer list once. One
 * install, one notification per observer, no matter how many copies exist.
 */

/** Amiba's language axis. `./index.ts` and `./plugin.ts` both alias this. */
export type MessageLanguage = "en" | "zh-CN";

/** One owner's dictionaries: flat `"domain.key"` -> template, both languages. */
export type MessageCatalog = Record<MessageLanguage, Record<string, string>>;

/**
 * Resolve a key to its TEMPLATE (placeholders un-substituted — interpolation
 * is the caller's, see {@link interpolate}), or `undefined` when the realm's
 * source does not know the key.
 *
 * `language` is the asking copy's resolved language. The official resolver
 * ignores it: `LocaleRuntime` reads its own active locale at call time, and
 * that snapshot is where the asking copy's language came from in the first
 * place. It matters for the runtime-less catalog resolver, which has no such
 * snapshot to read.
 */
export type MessageResolver = (
  key: string,
  language: MessageLanguage,
) => string | undefined;

const MESSAGES_KEY = Symbol.for("@amiba/i18n/messages");

interface MessageRegistry {
  /** The realm's ONE template source; null until an owner installs one. */
  resolve: MessageResolver | null;
  /**
   * Bumped on every install and dispose. Mounted trees key their memoised
   * `t` on it, so a dictionary that arrives AFTER the first paint still
   * repaints — the same reason upstream's `LocaleRuntime.register` bumps its
   * own snapshot revision. Amiba needs it for exactly that case: the shell
   * registers inside `ctx.inject(["locale"], …)`, which may well resolve
   * after the product shell has rendered.
   */
  epoch: number;
  /** Notified on every install/dispose. Realm-wide by design — see the header. */
  readonly observers: Set<() => void>;
}

function messageRegistry(): MessageRegistry {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[MESSAGES_KEY] as MessageRegistry | undefined;
  if (existing) return existing;
  const created: MessageRegistry = {
    resolve: null,
    epoch: 0,
    observers: new Set(),
  };
  realm[MESSAGES_KEY] = created;
  return created;
}

function publishMessages(): void {
  const registry = messageRegistry();
  registry.epoch += 1;
  for (const observer of [...registry.observers]) observer();
}

/**
 * The realm's message-registry revision. A render that wants to repaint when
 * a dictionary arrives keys on this.
 */
export function messagesEpoch(): number {
  return messageRegistry().epoch;
}

/** Observe installs and disposes. Returns a disposer. */
export function subscribeMessages(onChange: () => void): () => void {
  const observers = messageRegistry().observers;
  observers.add(onChange);
  return () => {
    observers.delete(onChange);
  };
}

/** True once some owner has installed a template source in this realm. */
export function hasMessages(): boolean {
  return messageRegistry().resolve !== null;
}

/**
 * Install the realm's template source.
 *
 * A later install SUPERSEDES an earlier one, and the disposer restores what
 * was there before — which is exactly how the shell hands over: it installs
 * its compile-time catalog while `ctx.locale` is still unavailable, then
 * installs the official namespace binding on top once the service resolves.
 * Disposing the official one falls back to the catalog rather than to
 * nothing. The `!==` guard means an out-of-order dispose is a no-op instead
 * of clobbering somebody else's install (the same guard
 * `installOfficialLocale` uses).
 */
export function installMessages(resolve: MessageResolver): () => void {
  const registry = messageRegistry();
  const superseded = registry.resolve;
  registry.resolve = resolve;
  publishMessages();
  return () => {
    if (registry.resolve !== resolve) return;
    registry.resolve = superseded;
    publishMessages();
  };
}

/**
 * A resolver over compile-time catalogs, for realms with no locale service.
 * English is the second chance, matching what `useT` did while the catalogs
 * were compiled in.
 */
export function catalogResolver(catalog: MessageCatalog): MessageResolver {
  return (key, language) => catalog[language]?.[key] ?? catalog.en[key];
}

/** {@link installMessages} over compile-time catalogs. */
export function installMessageCatalog(catalog: MessageCatalog): () => void {
  return installMessages(catalogResolver(catalog));
}

/**
 * The template for a key, or the KEY ITSELF when nothing in the realm knows
 * it. Fail loud: a missing string stays visible in the UI instead of
 * rendering blank — the same last resort upstream's `LocaleRuntime.translate`
 * takes, and the same one `useT` has always taken.
 */
export function resolveMessage(key: string, language: MessageLanguage): string {
  return messageRegistry().resolve?.(key, language) ?? key;
}

/**
 * `{name}` placeholder substitution. Kept on Amiba's side of the boundary
 * rather than delegated to the official `translate(ns, key, params)`: the two
 * disagree on an explicitly-`undefined` param value (upstream prints
 * `"undefined"`, Amiba leaves `{name}` in place, and `plugin.test.ts` pins
 * that), and every Amiba call site was written against this one. The official
 * service is asked for the TEMPLATE only, which is the part it owns.
 */
export function interpolate(
  template: string,
  params?: Record<string, unknown>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}
