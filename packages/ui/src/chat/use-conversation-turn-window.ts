import { useMemo, useLayoutEffect, useSyncExternalStore } from "react";
import { MESSAGE_TURN_WINDOW } from "./turn-window";

function createWindow() {
  let snapshot = { limit: MESSAGE_TURN_WINDOW, total: 0 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    expand() { snapshot = { ...snapshot, limit: snapshot.limit + MESSAGE_TURN_WINDOW }; for (const listener of listeners) listener(); },
    observe(total: number) {
      if (total <= snapshot.total) return;
      snapshot = { limit: snapshot.limit + (snapshot.total ? total - snapshot.total : 0), total };
      for (const listener of listeners) listener();
    },
  };
}
const windows = new WeakMap<object, ReturnType<typeof createWindow>>();
export function useConversationTurnWindow(sessionId?: string, scope?: object, total = 0) {
  const source = useMemo(() => {
    if (!scope) return createWindow();
    let saved = windows.get(scope);
    if (!saved) { saved = createWindow(); windows.set(scope, saved); }
    return saved;
  }, [sessionId, scope]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const limit = snapshot.limit + (snapshot.total ? Math.max(0, total - snapshot.total) : 0);
  useLayoutEffect(() => source.observe(total), [source, total]);
  return [limit, source.expand] as const;
}
