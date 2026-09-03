import { resolveSlotLabel, type SlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionBadgeSource, SessionListFilter } from "@amiba/ui";

/**
 * Minimal shape of one stored slot registration this module reads — a
 * structural subset of `StoredEntry` from `@deepseek-ai/dsh-client-ui-slots`,
 * so `ctx.slots.entriesOfSlot(...)` satisfies it directly without a cast at
 * the call site.
 */
export interface SlotContributionEntry {
  options: { id?: string; order?: number; label?: SlotLabel };
  inject?: (...args: never[]) => Record<string, unknown>;
}

/** The subset of `ctx.slots` a contributions source needs. */
export interface SlotContributionsCtx {
  getVersion(name: string): number;
  entriesOfSlot(name: string): readonly SlotContributionEntry[];
  subscribe(name: string, listener: () => void): () => void;
}

export interface ContributionsSource<T> {
  getSnapshot: () => readonly T[];
  subscribe: (listener: () => void) => () => void;
}

/**
 * Builds a `useSyncExternalStore`-shaped source over one list-kind slot's
 * registrations — the same caching/versioning/lang-observer pattern
 * `sectionsSource` in `index.tsx` uses for `settings.section`:
 * `ctx.getVersion` gates re-projection, `document.documentElement.lang`
 * changes force a re-resolve of thunked labels, and `ctx.subscribe` plus a
 * `lang` `MutationObserver` are both wired into the returned `subscribe`.
 *
 * `mapEntry` turns one stored entry into the plugin-facing contribution row,
 * or `null` to drop an entry missing its `id` or its business face (e.g. no
 * `resolve`/`test` function) — the result is sorted by `order` ascending.
 */
export function createSlotContributionsSource<T extends { order: number }>(
  ctx: SlotContributionsCtx,
  slotName: string,
  mapEntry: (entry: SlotContributionEntry) => T | null,
): ContributionsSource<T> {
  let version = -1;
  let language = "";
  let snapshot: readonly T[] = [];
  return {
    getSnapshot: () => {
      const currentVersion = ctx.getVersion(slotName);
      const currentLanguage =
        typeof document === "undefined" ? "" : document.documentElement.lang;
      if (currentVersion !== version || currentLanguage !== language) {
        version = currentVersion;
        language = currentLanguage;
        snapshot = ctx
          .entriesOfSlot(slotName)
          .map(mapEntry)
          .filter((entry): entry is T => entry !== null)
          .sort((left, right) => left.order - right.order);
      }
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      const disposeSlotSubscription = ctx.subscribe(slotName, listener);
      if (
        typeof document === "undefined" ||
        typeof MutationObserver === "undefined"
      ) {
        return disposeSlotSubscription;
      }
      const languageObserver = new MutationObserver(listener);
      languageObserver.observe(document.documentElement, {
        attributeFilter: ["lang"],
        attributes: true,
      });
      return () => {
        languageObserver.disconnect();
        disposeSlotSubscription();
      };
    },
  };
}

const SESSION_BADGE_SLOT = "amiba.sessions.item.badge";
const SESSION_FILTER_SLOT = "amiba.sessions.list.filter";

/**
 * The `amiba.sessions.item.badge` contributions source: one row per
 * registration carrying a `resolve` business face, sorted by `order`. A
 * plugin registers with
 * `ctx.slots.register({ name: "amiba.sessions.item.badge", id, order,
 * label, inject: () => ({ resolve }) }, NoopComponent)` — the registered
 * component itself is never rendered, exactly like `settings.section`.
 */
export function createSessionBadgesSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<SessionBadgeSource> {
  return createSlotContributionsSource<SessionBadgeSource>(
    ctx,
    SESSION_BADGE_SLOT,
    (entry) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      const face = entry.inject?.() as
        | { resolve?: SessionBadgeSource["resolve"] }
        | undefined;
      if (typeof face?.resolve !== "function") return null;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
        resolve: face.resolve,
      };
    },
  );
}

/** One `amiba.sessions.list.filter` contribution, `order` kept for sorting. */
export type SessionFilterRow = SessionListFilter & { order: number };

/**
 * The `amiba.sessions.list.filter` contributions source — same shape as
 * `createSessionBadgesSource`, keyed off a `test` business face instead of
 * `resolve`.
 */
export function createSessionFiltersSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<SessionFilterRow> {
  return createSlotContributionsSource<SessionFilterRow>(
    ctx,
    SESSION_FILTER_SLOT,
    (entry) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      const face = entry.inject?.() as
        | { test?: SessionListFilter["test"] }
        | undefined;
      if (typeof face?.test !== "function") return null;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
        test: face.test,
      };
    },
  );
}
