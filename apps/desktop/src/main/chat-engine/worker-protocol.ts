import type { AgentSubagentAddress } from "@amiba/app-runtime/platform";
/**
 * Wire protocol between the main process and the runtime-host worker.
 *
 * The chat engine holds the app's single set of DSH connections: it follows
 * sessions, receives every streamed frame and keeps the run state the windows
 * render. That work used to run inside the main process — the browser process,
 * whose event loop also owns window management, native menus and IPC dispatch —
 * so a busy turn competed with the UI. It now runs in a `utilityProcess` with
 * its own event loop, and the main process keeps only what genuinely belongs to
 * it: window subscriptions, routing frames to the windows that render them, and
 * the two services the worker cannot own (workspace resolution from the main
 * workspace manager, and draft serialization, which lives in the submitting
 * renderer).
 *
 * Frames still reach windows over the same `chat-engine:message` channel from
 * the main process, so no renderer changes.
 */

import type {
  ApprovalDecision,
  ApprovalRequest,
  EngineToClientMessage,
  RuntimeActionResult,
  SubmitPayload,
  SubmitReceipt,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "@amiba/app-runtime/protocol";

/** Everything the main process asks the worker to do on a session. */
export type EngineWorkerCommand =
  | { verb: "follow"; sessionId: string; subagent?: AgentSubagentAddress }
  | { verb: "unfollow"; sessionId: string }
  | { verb: "subscribe"; sessionId: string }
  | { verb: "requestSnapshot"; sessionId: string }
  | { verb: "submit"; payload: SubmitPayload }
  | { verb: "submitWithReceipt"; payload: SubmitPayload }
  | { verb: "abort"; sessionId: string }
  | { verb: "clear"; sessionId: string }
  | { verb: "clearApproval"; sessionId: string; approvalId: string }
  | {
      verb: "respondToApproval";
      request: ApprovalRequest;
      decision: ApprovalDecision;
    }
  | {
      verb: "respondToQuestions";
      request: UserQuestionRequest;
      answers: UserQuestionAnswerItem[];
    }
  | { verb: "cancelQuestions"; request: UserQuestionRequest };

/** Services the worker must borrow from the main process. */
export type EngineWorkerRequest =
  | { kind: "resolveSession"; sessionId: string }
  | { kind: "serializeDrafts"; sessionId: string; ids: string[] };

/**
 * The runtime connection the worker owns. Handed over on `init` — the main
 * process still spawns and supervises the DSH runtime itself (it owns the child
 * process and the cookie exchange), the worker only talks to it.
 */
export interface EngineConnection {
  baseUrl: string;
  browserCookie?: string;
}

export type MainToWorkerMessage =
  | ({ type: "init" } & EngineConnection)
  | { type: "command"; id: number; command: EngineWorkerCommand }
  | { type: "activity"; sessionId: string; running: boolean }
  /**
   * Durable subagent addresses, pushed as a whole map whenever the main store
   * changes. The engine reads them *synchronously* during submit and abort, so
   * they cannot be a round trip.
   */
  | { type: "subagents"; addresses: Record<string, AgentSubagentAddress> }
  | { type: "response"; id: number; ok: true; value: unknown }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "dispose" };

export type WorkerToMainMessage =
  | { type: "ready" }
  /**
   * Frames for one tick, batched *in the worker*: a streaming turn would
   * otherwise cross the process boundary once per delta.
   */
  | { type: "frames"; messages: EngineToClientMessage[] }
  | {
      type: "command-result";
      id: number;
      ok: boolean;
      value?: unknown;
      error?: string;
    }
  | { type: "request"; id: number; request: EngineWorkerRequest };

/**
 * The slice of a message port both sides use. `utilityProcess`'s parent port and
 * `process.parentPort` both satisfy it, and a test can link two plain objects
 * instead of spawning anything.
 */
export interface WorkerPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): void;
}

export interface EngineWorkerBridgeOptions {
  port: WorkerPort;
  /** Frames the worker batched for one tick, in order. */
  onFrames(messages: EngineToClientMessage[]): void;
  /** Borrow a main-process service; a rejection is reported back as an error. */
  handleRequest(request: EngineWorkerRequest): Promise<unknown>;
  /** The worker reported it constructed its engine. */
  onReady?(): void;
  /** The worker failed to start or crashed. */
  onError?(error: Error): void;
}

/**
 * Main-process side of the worker link: request/response correlation, frame
 * forwarding in arrival order, and the activity pushes the engine subscribes to.
 */
export class EngineWorkerBridge {
  private readonly port: WorkerPort;
  private readonly options: EngineWorkerBridgeOptions;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private disposed = false;

  constructor(options: EngineWorkerBridgeOptions) {
    this.options = options;
    this.port = options.port;
    this.port.on("message", (message) => this.receive(message));
  }

  /** Hand the worker the runtime connection it should own. */
  init(connection: EngineConnection): void {
    this.post({ type: "init", ...connection });
  }

  /** Run one engine command; resolves with its result when it has one. */
  command(command: EngineWorkerCommand): Promise<unknown> {
    if (this.disposed)
      return Promise.reject(new Error("The chat engine worker is closed."));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "command", id, command });
    });
  }

  /** Push a session-activity change the engine's `sessionActivity` observes. */
  notifyActivity(sessionId: string, running: boolean): void {
    if (this.disposed) return;
    this.post({ type: "activity", sessionId, running });
  }

  /** Push the durable subagent addresses the engine reads synchronously. */
  notifySubagents(addresses: Record<string, AgentSubagentAddress>): void {
    if (this.disposed) return;
    this.post({ type: "subagents", addresses });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.post({ type: "dispose" });
    } catch {
      // The port may already be gone; nothing left to tell.
    }
    for (const { reject } of this.pending.values())
      reject(new Error("The chat engine worker is closed."));
    this.pending.clear();
  }

  private post(message: MainToWorkerMessage): void {
    this.port.postMessage(message);
  }

  private receive(raw: unknown): void {
    const message = raw as WorkerToMainMessage | null;
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "ready":
        this.options.onReady?.();
        return;
      case "frames":
        if (!this.disposed) this.options.onFrames(message.messages);
        return;
      case "command-result": {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error ?? "Engine command failed."));
        return;
      }
      case "request":
        void this.answer(message.id, message.request);
        return;
      default:
        return;
    }
  }

  private async answer(id: number, request: EngineWorkerRequest): Promise<void> {
    try {
      const value = await this.options.handleRequest(request);
      this.post({ type: "response", id, ok: true, value: value ?? null });
    } catch (error) {
      this.post({
        type: "response",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Narrowing helpers the worker uses to answer with typed values. */
export type EngineWorkerResult =
  | RuntimeActionResult
  | SubmitReceipt
  | undefined;
