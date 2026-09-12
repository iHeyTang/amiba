import type { ExternalSessionInfo } from "../session-origin.js";
import type { SessionGroupContribution } from "@amiba/dsh-plugin-ui-shell/client";

/** Plugin-owned membership; the shell only renders its existing generic group seat. */
export function createExternalSessionGroup(
  classify: (ids: string[]) => Promise<ExternalSessionInfo[]>,
): { face: SessionGroupContribution; dispose(): void } {
  let members = new Map<string, ExternalSessionInfo>();
  const known = new Set<string>();
  let queued = false;
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => { queued = false; void refresh(); });
  };
  let disposed = false;
  let refreshing = false;
  let pending = false;
  const listeners = new Set<() => void>();
  const refresh = async () => {
    if (disposed) return;
    if (refreshing) { pending = true; return; }
    refreshing = true;
    try {
      const ids = [...known];
      const next = new Map<string, ExternalSessionInfo>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        for (const item of await classify(ids.slice(offset, offset + 100))) next.set(item.id, item);
        if (disposed) return;
      }
      if (!disposed && (next.size !== members.size || [...next].some(([id, item]) => {
        const previous = members.get(id);
        return previous?.connectorName !== item.connectorName || previous?.createdAt !== item.createdAt;
      }))) {
        members = next;
        for (const listener of listeners) listener();
      }
    } catch {
      // Keep the last successful membership through transient reconnects.
    } finally {
      refreshing = false;
      if (pending && !disposed) { pending = false; void refresh(); }
    }
  };
  // Retries blank logs and unavailable persistence after first-message arrival.
  const timer = setInterval(() => { void refresh(); }, 15000);
  return {
    face: {
      claim: (session) => {
        if (!known.has(session.id)) { known.add(session.id); schedule(); }
        return members.has(session.id);
      },
      title: (session) => {
        const item = members.get(session.id);
        if (!item || session.titleManual) return undefined;
        const date = new Date(item.createdAt);
        const pad = (value: number) => String(value).padStart(2, "0");
        const name = item.connectorName || (document.documentElement.lang.startsWith("zh") ? "外部消息" : "External messages");
        return `${name} · ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      known.clear();
      listeners.clear();
    },
  };
}
