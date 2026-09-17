import type { ExternalSessionInfo } from "../session-origin.js";
import type { SessionGroupContribution } from "@amiba/dsh-plugin-ui-shell/client";

/** Plugin-owned membership; the shell only renders its existing generic group seat. */
export function createExternalSessionGroup(
  classify: (ids: string[]) => Promise<ExternalSessionInfo[]>,
): { face: SessionGroupContribution; dispose(): void } {
  /** Cap on remembered session ids that feed the periodic classification. */
  const MAX_KNOWN_SESSIONS = 200;
  /**
   * An entry must be idle (not re-claimed) for this long before the cap may
   * evict it. Sessions are re-claimed every time the UI renders them, so a
   * recently-seen session is never dropped — only long-dead ones are, and a
   * dropped entry is re-added if the session is claimed again later.
   */
  const KNOWN_EVICT_IDLE_MS = 5 * 60 * 1000;
  const knownAt = new Map<string, number>();
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
  // Classifying grows with every claimed session, so don't pay for it while
  // the window is hidden; refresh immediately when it becomes visible again.
  const onVisibility = () => {
    if (!document.hidden) void refresh();
  };
  const timer = setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 15000);
  document.addEventListener("visibilitychange", onVisibility);
  return {
    face: {
      claim: (session) => {
        if (!known.has(session.id)) {
          known.add(session.id);
          knownAt.set(session.id, Date.now());
          // `known` grew without bound as sessions were claimed, so the 15s
          // classification re-classified every session the user ever opened.
          // Evict the oldest entries that are NOT currently grouped AND have
          // been idle long enough that dropping them cannot cost a pending
          // first-message retry; a dropped entry is re-added on the next claim.
          if (known.size > MAX_KNOWN_SESSIONS) {
            for (const id of known) {
              if (known.size <= MAX_KNOWN_SESSIONS) break;
              if (members.has(id)) continue;
              if (Date.now() - (knownAt.get(id) ?? 0) < KNOWN_EVICT_IDLE_MS) continue;
              known.delete(id);
              knownAt.delete(id);
            }
          }
          schedule();
        }
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
      document.removeEventListener("visibilitychange", onVisibility);
      known.clear();
      knownAt.clear();
      listeners.clear();
    },
  };
}
