import { useMemo, useLayoutEffect, useSyncExternalStore } from "react";
import { MESSAGE_TURN_WINDOW, MESSAGE_DOM_CAP } from "./turn-window";

/**
 * Per-session window state for the conversation view: how many turns render,
 * plus the message-count budget that additionally bounds tool-heavy sessions
 * (see `windowTurns`). `expand` grows BOTH so an explicit "load earlier"
 * gesture actually reveals older history instead of bumping a bound that the
 * other bound still pins.
 */
interface WindowSnapshot {
  limit: number;
  cap: number;
  total: number;
}
function createWindow(): {
  getSnapshot: () => WindowSnapshot;
  subscribe: (listener: () => void) => () => void;
  expand: () => void;
  observe: (total: number) => void;
} {
  let snapshot: WindowSnapshot = {
    limit: MESSAGE_TURN_WINDOW,
    cap: MESSAGE_DOM_CAP,
    total: 0,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    expand() {
      snapshot = {
        ...snapshot,
        limit: snapshot.limit + MESSAGE_TURN_WINDOW,
        cap: snapshot.cap + MESSAGE_DOM_CAP,
      };
      for (const listener of listeners) listener();
    },
    observe(total: number) {
      if (total <= snapshot.total) return;
      snapshot = {
        ...snapshot,
        limit:
          snapshot.limit + (snapshot.total ? total - snapshot.total : 0),
        total,
      };
      for (const listener of listeners) listener();
    },
  };
}
const windows = new WeakMap<object, ReturnType<typeof createWindow>>();
/**
 * @returns `[limit, expand, cap]` — the turn limit, a function that loads one
 * more slice, and the message budget that bounds the mounted slice.
 */
export function useConversationTurnWindow(
  sessionId?: string,
  scope?: object,
  total = 0,
) {
  const source = useMemo(() => {
    if (!scope) return createWindow();
    let saved = windows.get(scope);
    if (!saved) {
      saved = createWindow();
      windows.set(scope, saved);
    }
    return saved;
  }, [sessionId, scope]);
  const snapshot = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot,
  );
  const limit =
    snapshot.limit + (snapshot.total ? Math.max(0, total - snapshot.total) : 0);
  useLayoutEffect(() => source.observe(total), [source, total]);
  return [limit, source.expand, snapshot.cap] as const;
}