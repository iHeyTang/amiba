/**
 * DSH-native, session-owned durable reminder management. Deliberately local
 * to this plugin rather than the host platform contract — schedules are a
 * plugin-remote-backed domain end to end (`ctx.remote.amibaSchedules`), so
 * there is no engine-native RPC surface left for the host to stay coupled
 * to. Shared verbatim by the runtime side (`manager.ts`, `remote.ts`,
 * `remote-service.ts`) and the client page (`client/DshScheduledTasksPage.tsx`).
 */
export interface AgentScheduleView {
  id: string;
  sessionId: string;
  kind: "after" | "at" | "every";
  prompt: string;
  scheduledAt: string;
  state: "scheduled" | "overdue";
  deliveryMode: "session-local";
  afterSeconds?: number;
  everySeconds?: number;
}

export interface AgentScheduleCreateInput {
  prompt: string;
  afterSeconds?: number;
  everySeconds?: number;
  at?: string | { date: string; time: string; time_zone: string };
}

export interface AgentSchedulesAdapter {
  list(sessionId: string): Promise<AgentScheduleView[]>;
  create(
    sessionId: string,
    input: AgentScheduleCreateInput,
  ): Promise<AgentScheduleView>;
  remove(
    sessionId: string,
    id: string,
  ): Promise<{ id: string; deleted: boolean; code?: "schedule_not_found" }>;
}
