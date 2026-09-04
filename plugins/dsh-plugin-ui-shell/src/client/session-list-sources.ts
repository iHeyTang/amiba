import { resolveSlotLabel, type SlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  SessionListGroup,
  SessionListMenuItem,
} from "@amiba/ui";

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
 * One contribution's own change-notification hook, read off its `inject()`
 * business face when present — the `subscribe` half of
 * `SessionGroupContribution` / `SessionMenuContribution` in `index.tsx`.
 * Structural and generic on purpose: this module has no notion of "group"
 * vs "menu item", only "a business face that may optionally know how to
 * signal its own changes".
 */
type ContributionSubscribe = (listener: () => void) => () => void;

function subscribeOfFace(
  face: Record<string, unknown> | undefined,
): ContributionSubscribe | undefined {
  const subscribe = face?.subscribe;
  return typeof subscribe === "function"
    ? (subscribe as ContributionSubscribe)
    : undefined;
}

/**
 * Builds a `useSyncExternalStore`-shaped source over one list-kind slot's
 * registrations — the same caching/versioning/lang-observer pattern
 * `sectionsSource` in `index.tsx` uses for `settings.section`:
 * `ctx.getVersion` gates re-projection, `document.documentElement.lang`
 * changes force a re-resolve of thunked labels, and `ctx.subscribe` plus a
 * `lang` `MutationObserver` are both wired into the returned `subscribe`.
 *
 * `mapEntry` turns one stored entry (plus its already-resolved `inject()`
 * face, so callers don't call `inject()` a second time themselves) into the
 * plugin-facing contribution row, or `null` to drop an entry missing its
 * `id` or its business face (e.g. no `claim`/`run` function) — the
 * result is sorted by `order` ascending.
 *
 * On top of the slot-registration/version/lang axis, each KEPT entry's own
 * `face.subscribe` (when present) is wired into an internal `dataVersion`
 * counter: a contribution firing its listener (its managed set refreshed,
 * an IM channel's membership changed, …) bumps `dataVersion`, which (a)
 * forces the next `getSnapshot()` to return a NEW array identity — same
 * contents is fine, only the reference needs to change — and (b) notifies
 * this source's own subscriber. `useSyncExternalStore` in `product-shell.tsx`
 * is what turns that into a re-render, and the derived `sessionGroupList` /
 * `sessionMenuItemList` arrays (memoized on the snapshot array's identity)
 * get recomputed with it.
 *
 * Contribution subscriptions are (re)wired on every `subscribe()` call and
 * every time the slot's own registrations change (`ctx.subscribe(slotName,
 * …)` firing) — old subscriptions disposed first, new ones attached from
 * the freshly re-projected entry set — and all of them are disposed when
 * the returned `subscribe()`'s disposer runs.
 */
export function createSlotContributionsSource<T extends { order: number }>(
  ctx: SlotContributionsCtx,
  slotName: string,
  mapEntry: (
    entry: SlotContributionEntry,
    face: Record<string, unknown> | undefined,
  ) => T | null,
): ContributionsSource<T> {
  let version = -1;
  let language = "";
  let dataVersion = 0;
  let snapshotDataVersion = -1;
  let snapshot: readonly T[] = [];
  // The kept entries' own `subscribe` faces, as of the last projection —
  // what a `subscribe()` call (or a re-projection while already subscribed)
  // wires listeners to.
  let contributionSubscribes: readonly ContributionSubscribe[] = [];

  /** Re-reads `entriesOfSlot`/lang when the slot's version or the active
   *  language changed since the last call; returns whether it did. */
  const project = (): boolean => {
    const currentVersion = ctx.getVersion(slotName);
    const currentLanguage =
      typeof document === "undefined" ? "" : document.documentElement.lang;
    if (currentVersion === version && currentLanguage === language) {
      return false;
    }
    version = currentVersion;
    language = currentLanguage;
    const kept: { row: T; subscribe?: ContributionSubscribe }[] = [];
    for (const entry of ctx.entriesOfSlot(slotName)) {
      const face = entry.inject?.();
      const row = mapEntry(entry, face);
      if (row === null) continue;
      kept.push({ row, subscribe: subscribeOfFace(face) });
    }
    kept.sort((left, right) => left.row.order - right.row.order);
    snapshot = kept.map((k) => k.row);
    contributionSubscribes = kept
      .map((k) => k.subscribe)
      .filter((s): s is ContributionSubscribe => Boolean(s));
    return true;
  };

  return {
    getSnapshot: () => {
      const reprojected = project();
      if (reprojected) {
        snapshotDataVersion = dataVersion;
      } else if (snapshotDataVersion !== dataVersion) {
        // No registration/lang change, but a contribution signalled a data
        // change: same rows, new array identity so `useSyncExternalStore`
        // treats this as a change.
        snapshotDataVersion = dataVersion;
        snapshot = snapshot.slice();
      }
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      const onContributionChange = () => {
        dataVersion += 1;
        listener();
      };
      let contributionDisposers: Array<() => void> = [];
      const rewireContributions = () => {
        for (const dispose of contributionDisposers) dispose();
        contributionDisposers = contributionSubscribes.map((subscribe) =>
          subscribe(onContributionChange),
        );
      };
      // `subscribe()` may be the very first call this source ever sees (no
      // prior `getSnapshot()`) — project once up front so
      // `contributionSubscribes` is populated before wiring.
      project();
      rewireContributions();

      const disposeSlotSubscription = ctx.subscribe(slotName, () => {
        // Entries were added/removed/changed: re-project so
        // `contributionSubscribes` reflects the new set, then re-wire
        // (old subscriptions disposed, new ones attached) before notifying.
        project();
        rewireContributions();
        listener();
      });

      if (
        typeof document === "undefined" ||
        typeof MutationObserver === "undefined"
      ) {
        return () => {
          for (const dispose of contributionDisposers) dispose();
          disposeSlotSubscription();
        };
      }
      const languageObserver = new MutationObserver(listener);
      languageObserver.observe(document.documentElement, {
        attributeFilter: ["lang"],
        attributes: true,
      });
      return () => {
        languageObserver.disconnect();
        for (const dispose of contributionDisposers) dispose();
        disposeSlotSubscription();
      };
    },
  };
}

const SESSION_GROUP_SLOT = "amiba.sessions.list.group";
const SESSION_MENU_SLOT = "amiba.sessions.item.menu";

/** One `amiba.sessions.list.group` contribution, `order` kept for sorting. */
export type SessionGroupRow = SessionListGroup & { order: number };

/**
 * The `amiba.sessions.list.group` contributions source — same
 * `createSlotContributionsSource` shape as `createSessionMenuItemsSource`,
 * keyed off a `claim` business face (the only required one; `subscribe` is
 * optional, same as the menu-item source).
 */
export function createSessionGroupsSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<SessionGroupRow> {
  return createSlotContributionsSource<SessionGroupRow>(
    ctx,
    SESSION_GROUP_SLOT,
    (entry, face) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      const claim = (
        face as { claim?: SessionListGroup["claim"] } | undefined
      )?.claim;
      if (typeof claim !== "function") return null;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
        claim,
      };
    },
  );
}

/** One `amiba.sessions.item.menu` contribution, `order` kept for sorting. */
export type SessionMenuItemRow = SessionListMenuItem & { order: number };

/**
 * The `amiba.sessions.item.menu` contributions source — same
 * `createSlotContributionsSource` shape as `createSessionGroupsSource`,
 * keyed off a `run` business face (the only required one; `visible` is
 * optional and defaults to "always visible" the same way
 * `SessionListMenuItem.visible` does downstream in `resolveMenuItems`).
 */
export function createSessionMenuItemsSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<SessionMenuItemRow> {
  return createSlotContributionsSource<SessionMenuItemRow>(
    ctx,
    SESSION_MENU_SLOT,
    (entry, face) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      const run = (
        face as { run?: SessionListMenuItem["run"] } | undefined
      )?.run;
      if (typeof run !== "function") return null;
      const visible = (
        face as { visible?: SessionListMenuItem["visible"] } | undefined
      )?.visible;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
        run,
        ...(typeof visible === "function" ? { visible } : {}),
      };
    },
  );
}
