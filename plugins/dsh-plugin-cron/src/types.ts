/**
 * Amiba cron — durable task definitions that spawn a FRESH agent session when
 * they fire (daily reports, news digests, …).
 *
 * Naming is deliberate: "schedule" belongs to `@deepseek-ai/dsh-schedule`,
 * the official session-local reminder engine (an agent capability that
 * follows up inside an existing conversation). Cron is the other thing —
 * "at this time, start a new task" — which upstream does not provide
 * (verified against the full @deepseek-ai npm scope; `dsh-jobs*` is a
 * background registry for long-running tool work, not scheduling).
 */

/** When a task fires. */
export type CronRule =
  | {
      /** One-shot at an absolute instant. */
      kind: "at";
      /** RFC 3339 instant with explicit offset or Z. */
      at: string;
    }
  | {
      /** Every day at a wall-clock time in a fixed zone. */
      kind: "daily";
      /** "HH:mm", 24h. */
      time: string;
      /** IANA zone the wall-clock time is read in. */
      timeZone: string;
    }
  | {
      /** Fixed interval, anchored at the task's creation. */
      kind: "every";
      /** Interval in seconds; at least 300. */
      everySeconds: number;
    };

export interface CronRun {
  sessionId: string;
  startedAt: number;
  /** The agent became idle; inspect the conversation for its outcome. */
  finishedAt?: number;
}

export interface CronTask {
  id: string;
  name: string;
  /** The user message the fresh session starts with. */
  prompt: string;
  rule: CronRule;
  enabled: boolean;
  /**
   * Whether a fire missed while the runtime was down runs once at startup.
   * Off by default: an explicit per-task opt-in, never an invented policy.
   */
  catchUp: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  /** Session spawned by the most recent run. */
  lastSessionId?: string;
  /** Durable history, newest run first. Older stores may only have lastSessionId. */
  runs?: CronRun[];
}

export interface CronTaskCreateInput {
  name: string;
  prompt: string;
  rule: CronRule;
  catchUp?: boolean;
}

export interface CronTaskPatch {
  name?: string;
  prompt?: string;
  rule?: CronRule;
  enabled?: boolean;
  catchUp?: boolean;
}

/** What the management UI renders. */
export interface CronTaskView extends CronTask {
  /** Next fire, or null when disabled or exhausted (a past one-shot). */
  nextRunAt: number | null;
}
