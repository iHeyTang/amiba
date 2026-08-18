import { useCallback } from "react";

import type { SessionMeta } from "@amiba/app-runtime/core";

export interface ScheduledRuns {
  runs: SessionMeta[];
  ready: boolean;
  refresh: () => void | Promise<void>;
  labelFor: (source: string) => string;
  actionsFor: (source: string) => null;
  activeRunTitle: (activeId: string) => null;
}

/**
 * DSH reminders execute inside their owning session, so there is no second
 * synthetic run-history index to merge into the task sidebar. The dedicated
 * Scheduled page reads the native session-scoped schedule API directly.
 */
export function useScheduledRuns(): ScheduledRuns {
  return {
    runs: [],
    ready: true,
    refresh: () => undefined,
    labelFor: useCallback((source: string) => source, []),
    actionsFor: useCallback((_source: string) => null, []),
    activeRunTitle: useCallback((_activeId: string) => null, []),
  };
}
