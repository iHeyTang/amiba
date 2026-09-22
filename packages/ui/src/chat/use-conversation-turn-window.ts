import { useMemo, useSyncExternalStore } from "react";
import { MESSAGE_TURN_WINDOW } from "./turn-window";

function createWindow() {
  let limit = MESSAGE_TURN_WINDOW;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => limit,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    expand() { limit += MESSAGE_TURN_WINDOW; for (const listener of listeners) listener(); },
  };
}
const windows = new WeakMap<object, ReturnType<typeof createWindow>>();
export function useConversationTurnWindow(sessionId?: string, scope?: object) {
  const source = useMemo(() => {
    if (!scope) return createWindow();
    let saved = windows.get(scope);
    if (!saved) { saved = createWindow(); windows.set(scope, saved); }
    return saved;
  }, [sessionId, scope]);
  const limit = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return [limit, source.expand] as const;
}
