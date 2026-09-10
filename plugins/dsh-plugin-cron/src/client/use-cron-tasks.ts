import { useCallback, useEffect, useRef, useState } from "react";
import type { CronTaskView } from "../types.js";
import type { CronAdapter } from "./DshCronPage.js";

/** Keep the panel and its menu live, preserving rows during background refreshes. */
export function useCronTasks(adapter: CronAdapter, sessionIds?: string[]) {
  const [tasks, setTasks] = useState<CronTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const candidates = useRef(sessionIds);
  candidates.current = sessionIds;
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await adapter.list(candidates.current);
      if (request !== revision.current) return;
      setTasks((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      setError(null);
    } catch (cause) {
      if (request === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [adapter]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      disposed = true;
      ++revision.current;
      clearTimeout(timer);
    };
  }, [refresh]);
  return { tasks, loading, error, setError, refresh };
}
