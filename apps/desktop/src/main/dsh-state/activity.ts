/**
 * Window-independent session-activity tracker.
 *
 * The pet window used to receive conversation activity published by the MAIN
 * window's chat surface, which died with the main window (that channel is
 * gone). This source derives the same presentation signal directly from the
 * DSH runtime so any window can reflect "what is Amiba doing right now":
 *
 *   1. Follows the global events mux for interaction waits (approvals /
 *      questions) and the session-title projection.
 *   2. Follows the most recently active running session's journal
 *      (`session/follow`) and projects its raw events onto the same phase
 *      lattice the chat surface uses (thinking / responding / tooling /
 *      waiting / completed / failed / interrupted).
 *
 * The projection is intentionally presentation-only: it mirrors
 * `createSurfaceActivity`'s phases but never drives execution.
 */

import type { DshApiClient } from "@amiba/app-runtime/dsh-client";
import type { DesktopPetActivity } from "@amiba/app-runtime/platform";
import type { SessionIndex } from "../session-index";
import type { DshSessionRow } from "./types";

interface RawSessionEvent {
  type: string;
  seq: number;
  time: number;
  data?: Record<string, unknown>;
}

const IDLE_ACTIVITY: DesktopPetActivity = {
  phase: "idle",
  restored: true,
  sessionId: "",
  revision: 0,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function toolResultCallId(message: unknown): string {
  const value = record(message);
  if (!value) return "";
  if (typeof value.toolCallId === "string") return value.toolCallId;
  const source = record(value.source);
  if (typeof source?.callId === "string") return source.callId;
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      const item = record(block);
      if (item?.type === "tool-result" && typeof item.toolCallId === "string") {
        return item.toolCallId;
      }
    }
  }
  return "";
}

/** Most recently active non-blank session, preferring a running one. */
export function pickCurrentSession(
  rows: DshSessionRow[],
): DshSessionRow | undefined {
  const active = rows.filter((row) => !row.blank);
  if (active.length === 0) return undefined;
  const running = active.filter((row) => row.running);
  const pool = running.length > 0 ? running : active;
  return [...pool].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export class ActivitySource {
  private activity: DesktopPetActivity = IDLE_ACTIVITY;
  private title: string | undefined;
  private followedSession = "";
  private hasSessionSnapshot = false;
  private latestSeenUpdate = -Infinity;
  private journalController: AbortController | undefined;
  private globalController: AbortController | undefined;
  private readonly offSessions: () => void;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  private readonly approvals = new Set<string>();
  private readonly questions = new Set<string>();
  private readonly tools = new Set<string>();
  private base:
    | "idle"
    | "thinking"
    | "responding"
    | "completed"
    | "failed"
    | "interrupted" = "idle";
  private restored = true;
  private revision = 0;

  private readonly client: () => Promise<DshApiClient>;
  constructor(client: () => Promise<DshApiClient>, sessions: SessionIndex) {
    this.client = client;
    this.offSessions = sessions.onChange((rows) => this.onSessions(rows));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DesktopPetActivity {
    return this.activity;
  }

  start(): void {
    void this.startGlobal();
  }

  private async startGlobal(): Promise<void> {
    if (this.globalController) return;
    this.globalController = new AbortController();
    const controller = this.globalController;
    // Unlike the address-scoped journal, the global events mux has no
    // client-side reconnect, so re-establish it with a small backoff on drops
    // (runtime restarts, backplane blips). The journal follow below has its
    // own internal reconnect loop.
    while (!this.disposed && !controller.signal.aborted) {
      try {
        const client = await this.client();
        for await (const envelope of client.events(controller.signal)) {
          if (this.disposed) return;
          const frame = envelope.payload;
          if (!("sessionId" in frame) || frame.sessionId !== this.followedSession) {
            continue;
          }
          switch (frame.type) {
            case "approval/requested":
              this.approvals.add(frame.approvalId);
              break;
            case "approval/resolved":
              this.approvals.delete(frame.approvalId);
              break;
            case "question/requested":
              this.questions.add(envelope.rpcId);
              break;
            case "question/resolved":
              this.questions.delete(frame.questionRpcId);
              break;
            case "session/projection":
              if (frame.key === "title" && typeof frame.value === "string") {
                this.title = frame.value;
              }
              break;
            default:
              continue;
          }
          this.publish(false);
        }
      } catch {
        // Carrier drop — reconnect after a short pause.
      }
      if (this.disposed || controller.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  private onSessions(rows: DshSessionRow[]): void {
    const current = pickCurrentSession(rows);
    // Short turns can start and finish between index polls. Replay new
    // activity after startup as well, so their terminal state is not lost.
    const shouldFollow = !!current && (current.running ||
      (this.hasSessionSnapshot && current.updatedAt > this.latestSeenUpdate));
    this.hasSessionSnapshot = true;
    for (const row of rows) this.latestSeenUpdate = Math.max(this.latestSeenUpdate, row.updatedAt);
    const nextTitle =
      current?.title || rows.find((row) => row.sessionId === this.followedSession)?.title;
    if (nextTitle !== undefined) this.title = nextTitle;
    const nextId = current?.sessionId ?? "";
    if (nextId === this.followedSession) {
      if (shouldFollow && !this.journalController) void this.startJournal(nextId);
      this.publish(false);
      return;
    }
    this.stopJournal();
    this.followedSession = nextId;
    this.approvals.clear();
    this.questions.clear();
    this.tools.clear();
    this.base = "idle";
    this.restored = true;
    // An idle homepage needs only the index's title, not a cold replay of the
    // last conversation. Start following when work runs; retain that live
    // subscription through turn/end so completion/errors are still observed.
    if (nextId && shouldFollow) void this.startJournal(nextId);
    this.publish(true);
  }

  private async startJournal(sessionId: string): Promise<void> {
    const controller = new AbortController();
    this.journalController = controller;
    try {
      const client = await this.client();
      for await (const envelope of client.events(
        controller.signal,
        undefined,
        { kind: "session", sessionId },
      )) {
        if (this.disposed || controller.signal.aborted || this.journalController !== controller) return;
        const frame = envelope.payload;
        if (frame.type === "session/event") {
          this.applyEvent(frame.event as unknown as RawSessionEvent);
        } else if (frame.type === "session/subscribed") {
          this.restored = true;
        }
        this.publish(false);
      }
    } catch {
      // Only exits on abort (session switch) or runtime loss; a transient
      // carrier drop is retried inside client.events.
    } finally {
      if (this.journalController === controller) {
        this.journalController = undefined;
      }
    }
  }

  private stopJournal(): void {
    this.journalController?.abort();
    this.journalController = undefined;
  }

  private applyEvent(source: RawSessionEvent): void {
    const data = record(source.data) ?? {};
    switch (source.type) {
      case "turn/start":
        this.approvals.clear();
        this.questions.clear();
        this.tools.clear();
        this.base = "thinking";
        break;
      case "assistant/chunk": {
        const chunk = record(data.chunk);
        if (chunk?.type === "text-delta") this.base = "responding";
        else if (chunk?.type === "reasoning-delta") this.base = "thinking";
        break;
      }
      case "tool/call":
        if (typeof data.callId === "string" && data.callId) {
          this.tools.add(data.callId);
        }
        break;
      case "tool/result": {
        const callId = toolResultCallId(data.message);
        if (callId) this.tools.delete(callId);
        break;
      }
      case "turn/end": {
        this.approvals.clear();
        this.questions.clear();
        this.tools.clear();
        const reason = record(data.reason);
        if (reason?.kind === "aborted") this.base = "interrupted";
        else if (reason?.kind === "error") this.base = "failed";
        else this.base = "completed";
        break;
      }
      default:
        break;
    }
  }

  /** Merge wait/tool/base state into the published activity, deduped. */
  private publish(forceRestored: boolean): void {
    if (this.disposed) return;
    const phase =
      this.approvals.size || this.questions.size
        ? "waiting"
        : this.tools.size
          ? "tooling"
          : this.base;
    const next: DesktopPetActivity = {
      phase,
      ...(this.title ? { title: this.title } : {}),
      restored: this.restored,
      sessionId: this.followedSession,
      revision: ++this.revision,
    };
    if (
      !forceRestored &&
      phase === this.activity.phase &&
      next.restored === this.activity.restored &&
      next.sessionId === this.activity.sessionId &&
      next.title === this.activity.title
    ) {
      return;
    }
    this.activity = next;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    this.offSessions();
    this.stopJournal();
    this.globalController?.abort();
    this.globalController = undefined;
    this.listeners.clear();
  }
}