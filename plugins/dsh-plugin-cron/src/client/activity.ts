import type { CronRun, CronTaskView } from "../types.js";

/** Structural viewer face supplied by the shell's workspace seats. */
export interface SessionActivity {
  sessions: readonly {
    id: string;
    unread?: boolean;
    readAt?: number;
    archived?: boolean;
  }[];
  visibleSessionId: string;
  markUnread(id: string, activityAt?: number): Promise<void>;
  markRead(id: string, activityAt?: number): Promise<void>;
}

export function taskRuns(task: CronTaskView): CronRun[] {
  return (
    task.runs ??
    (task.lastSessionId
      ? [
          {
            sessionId: task.lastSessionId,
            startedAt: task.lastRunAt ?? task.createdAt,
          },
        ]
      : [])
  );
}

export function runUnread(run: CronRun, activity?: SessionActivity): boolean {
  if (!activity || run.sessionId === activity.visibleSessionId) return false;
  const session = activity.sessions.find((item) => item.id === run.sessionId);
  if (session?.archived) return false;
  return (
    !!session?.unread ||
    (session?.readAt ?? -Infinity) < (run.finishedAt ?? run.startedAt)
  );
}

/** Replayed on reconnect: acknowledging a run is durable and never undone by polling. */
export async function reconcileRuns(
  tasks: readonly CronTaskView[],
  activity: SessionActivity,
): Promise<void> {
  for (const task of tasks)
    for (const run of taskRuns(task)) {
      const session = activity.sessions.find(
        (item) => item.id === run.sessionId,
      );
      if (session?.archived) continue;
      const at = run.finishedAt ?? run.startedAt;
      if (run.sessionId === activity.visibleSessionId) {
        if (session?.unread || (session?.readAt ?? -Infinity) < at)
          await activity.markRead(run.sessionId, at);
      } else if (!session?.unread && (session?.readAt ?? -Infinity) < at) {
        await activity.markUnread(run.sessionId, at);
      }
    }
}
