/**
 * Worker side of the runtime host: owns the engine, borrows main's services.
 *
 * Deliberately free of Electron imports so the protocol can be exercised by a
 * test over a linked pair of ports with a fake engine — the same code the
 * `utilityProcess` entry runs.
 */

import type {
  AgentSubagentAddress,
  ApprovalDecision,
  ApprovalRequest,
  EngineToClientMessage,
  RuntimeActionResult,
  SubmitPayload,
  SubmitReceipt,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "@amiba/app-runtime/protocol";
import { createFrameBatcher } from "../frame-batcher.ts";
import type {
  EngineConnection,
  EngineWorkerCommand,
  EngineWorkerRequest,
  MainToWorkerMessage,
  WorkerPort,
  WorkerToMainMessage,
} from "./worker-protocol";

/** The engine verbs the worker drives; `DshChatEngineClient` satisfies it. */
export interface EngineWorkerEngine {
  follow(sessionId: string, subagent?: AgentSubagentAddress): void;
  unfollow(sessionId: string): void;
  subscribe(sessionId: string): void;
  requestSnapshot(sessionId: string): void;
  submit(payload: SubmitPayload): void | Promise<void>;
  submitWithReceipt(payload: SubmitPayload): Promise<SubmitReceipt>;
  abort(sessionId: string): void;
  clear(sessionId: string): void;
  clearApproval(sessionId: string, approvalId: string): void;
  respondToApproval(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<RuntimeActionResult>;
  respondToQuestions(
    request: UserQuestionRequest,
    answers: UserQuestionAnswerItem[],
  ): Promise<RuntimeActionResult>;
  cancelQuestions(request: UserQuestionRequest): Promise<RuntimeActionResult>;
  dispose(): void;
}

/** What the worker's engine gets back from the main process. */
export interface WorkerEngineHost {
  /** Send one frame to main, which routes it to the windows that render it. */
  emitFrame(message: EngineToClientMessage): void;
  /** Borrow a main-process service (workspace resolution, draft serialization). */
  request(request: EngineWorkerRequest): Promise<unknown>;
  /**
   * The durable subagent address for a session, from the map main pushes — read
   * synchronously, because the engine asks during submit and abort.
   */
  subagentAddress(sessionId: string): AgentSubagentAddress | undefined;
  /** The session's running flag, fed by main's activity pushes. */
  sessionActivity(sessionId: string): {
    getSnapshot(): { running: boolean };
    subscribe(listener: () => void): () => void;
  };
}

export type EngineWorkerFactory = (
  host: WorkerEngineHost,
  connection: EngineConnection,
) => EngineWorkerEngine | Promise<EngineWorkerEngine>;

export interface EngineWorkerRuntimeOptions {
  port: WorkerPort;
  /** Built on `init`, once the runtime connection is known. */
  createEngine: EngineWorkerFactory;
}

export function createEngineWorkerRuntime(
  options: EngineWorkerRuntimeOptions,
): { dispose(): void } {
  const { port } = options;
  let engine: EngineWorkerEngine | null = null;
  let disposed = false;

  const pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextRequestId = 1;

  const running = new Map<string, boolean>();
  const activityListeners = new Set<() => void>();
  let subagentAddresses: Record<string, AgentSubagentAddress> = {};

  const post = (message: WorkerToMainMessage): void => {
    if (disposed) return;
    port.postMessage(message);
  };

  /**
   * Frames are batched *here*, before they cross the process boundary: a
   * streaming turn produces one frame per delta, and sending them individually
   * would mean one structured clone per delta in each direction.
   */
  const frames = createFrameBatcher<EngineToClientMessage>((messages) =>
    post({ type: "frames", messages }),
  );

  const host: WorkerEngineHost = {
    emitFrame: (message) => frames.push(message),
    request: (request) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextRequestId++;
        pendingRequests.set(id, { resolve, reject });
        post({ type: "request", id, request });
      }),
    subagentAddress: (sessionId) => subagentAddresses[sessionId],
    sessionActivity: (sessionId) => ({
      getSnapshot: () => ({ running: running.get(sessionId) ?? false }),
      subscribe: (listener) => {
        activityListeners.add(listener);
        return () => activityListeners.delete(listener);
      },
    }),
  };

  const handleCommand = async (
    id: number,
    command: EngineWorkerCommand,
  ): Promise<void> => {
    if (!engine) {
      post({
        type: "command-result",
        id,
        ok: false,
        error: "The chat engine is not ready.",
      });
      return;
    }
    try {
      const value = await runCommand(engine, command);
      post({ type: "command-result", id, ok: true, value: value ?? null });
    } catch (error) {
      post({
        type: "command-result",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const receive = (raw: unknown): void => {
    const message = raw as MainToWorkerMessage | null;
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "init":
        void (async () => {
          try {
            const connection: EngineConnection = {
              baseUrl: message.baseUrl,
              ...(message.browserCookie === undefined
                ? {}
                : { browserCookie: message.browserCookie }),
            };
            engine = await options.createEngine(host, connection);
            post({ type: "ready" });
          } catch (error) {
            post({
              type: "command-result",
              id: 0,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        return;
      case "command":
        void handleCommand(message.id, message.command);
        return;
      case "activity":
        running.set(message.sessionId, message.running);
        for (const listener of [...activityListeners]) listener();
        return;
      case "subagents":
        subagentAddresses = message.addresses;
        return;
      case "response": {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error));
        return;
      }
      case "dispose":
        dispose();
        return;
      default:
        return;
    }
  };

  port.on("message", receive);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    frames.dispose();
    engine?.dispose();
    engine = null;
    for (const { reject } of pendingRequests.values())
      reject(new Error("The chat engine worker is closing."));
    pendingRequests.clear();
    activityListeners.clear();
  }

  return { dispose };
}

function runCommand(
  engine: EngineWorkerEngine,
  command: EngineWorkerCommand,
): unknown {
  switch (command.verb) {
    case "follow":
      engine.follow(command.sessionId, command.subagent);
      return undefined;
    case "unfollow":
      engine.unfollow(command.sessionId);
      return undefined;
    case "subscribe":
      engine.subscribe(command.sessionId);
      return undefined;
    case "requestSnapshot":
      engine.requestSnapshot(command.sessionId);
      return undefined;
    case "submit":
      return engine.submit(command.payload);
    case "submitWithReceipt":
      return engine.submitWithReceipt(command.payload);
    case "abort":
      engine.abort(command.sessionId);
      return undefined;
    case "clear":
      engine.clear(command.sessionId);
      return undefined;
    case "clearApproval":
      engine.clearApproval(command.sessionId, command.approvalId);
      return undefined;
    case "respondToApproval":
      return engine.respondToApproval(command.request, command.decision);
    case "respondToQuestions":
      return engine.respondToQuestions(command.request, command.answers);
    case "cancelQuestions":
      return engine.cancelQuestions(command.request);
    default:
      return undefined;
  }
}
