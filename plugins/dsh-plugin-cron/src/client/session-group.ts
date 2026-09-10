import type { SessionGroupContribution } from "@amiba/dsh-plugin-ui-shell/client";

/** Plugin-owned membership; the shell only renders its existing generic group seat. */
export function createCronSessionGroup(
  classify: (ids: string[]) => Promise<string[]>,
): { face: SessionGroupContribution; dispose(): void } {
  let members = new Set<string>();
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
      const next = new Set<string>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        for (const id of await classify(ids.slice(offset, offset + 100))) next.add(id);
        if (disposed) return;
      }
      if (!disposed && (next.size !== members.size || [...next].some((id) => !members.has(id)))) {
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
