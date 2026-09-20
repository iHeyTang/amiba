/**
 * The engine surface the main process drives, backed by the worker.
 *
 * `ChatEngineHost` used to hold a `DshChatEngineClient` directly. It now holds a
 * facade with the same method names, so the host keeps its routing, IPC surface
 * and window bookkeeping untouched while every call and every frame crosses to
 * the runtime-host worker.
 */

import { utilityProcess, type UtilityProcess } from "electron";
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

import {
  EngineWorkerBridge,
  type EngineConnection,
  type EngineWorkerRequest,
  type WorkerPort,
} from "./worker-protocol";

/** The engine verbs the host uses; `DshChatEngineClient` also satisfies it. */
export interface HostedEngine {
  follow(sessionId: string, subagent?: import("@amiba/app-runtime/platform").AgentSubagentAddress): void;
  unfollow(sessionId: string): void;
  subscribe(sessionId: string): void;
  requestSnapshot(sessionId: string): void;
  submit(payload: SubmitPayload): void;
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

export interface EngineWorkerHandle {
  engine: HostedEngine;
  bridge: EngineWorkerBridge;
  /** Terminate the utilityProcess. */
  kill(): void;
}

export interface SpawnEngineWorkerOptions {
  /** Absolute path of the built worker bundle (`out/main/chat-engine-worker.js`). */
  entryPath: string;
  connection: EngineConnection;
  /** Frames the worker batched for one tick, in order. */
  onFrames(messages: EngineToClientMessage[]): void;
  handleRequest(request: EngineWorkerRequest): Promise<unknown>;
  /** Subagent addresses the engine reads synchronously. */
  subagents(): Record<string, import("@amiba/app-runtime/platform").AgentSubagentAddress>;
  /** Session running flags, re-pushed whenever the shared index changes. */
  activity(): Array<[sessionId: string, running: boolean]>;
  onError?(error: Error): void;
}

/**
 * Fork the runtime host, hand it the runtime connection, and return a facade the
 * host can drive exactly like the in-process engine.
 */
export function spawnEngineWorker(
  options: SpawnEngineWorkerOptions,
): EngineWorkerHandle {
  const child: UtilityProcess = utilityProcess.fork(options.entryPath, [], {
    serviceName: "amiba-chat-engine",
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    options.onError?.(
      new Error(`The chat engine worker exited (code=${code ?? "unknown"}).`),
    );
  });

  const port: WorkerPort = {
    postMessage: (message) => child.postMessage(message),
    on: (_event, listener) => {
      // A utilityProcess parent receives the value itself, not a MessageEvent.
      child.on("message", (message: unknown) => listener(message));
    },
  };

  const bridge = new EngineWorkerBridge({
    port,
    onFrames: options.onFrames,
    handleRequest: options.handleRequest,
    onError: options.onError,
  });
  bridge.init(options.connection);
  bridge.notifySubagents(options.subagents());
  for (const [sessionId, running] of options.activity())
    bridge.notifyActivity(sessionId, running);

  let disposed = false;
  const engine: HostedEngine = {
    follow: (sessionId, subagent) =>
      void bridge.command({ verb: "follow", sessionId, ...(subagent ? { subagent } : {}) }),
    unfollow: (sessionId) => void bridge.command({ verb: "unfollow", sessionId }),
    subscribe: (sessionId) => void bridge.command({ verb: "subscribe", sessionId }),
    requestSnapshot: (sessionId) =>
      void bridge.command({ verb: "requestSnapshot", sessionId }),
    submit: (payload) => void bridge.command({ verb: "submit", payload }),
    submitWithReceipt: (payload) =>
      bridge.command({
        verb: "submitWithReceipt",
        payload,
      }) as Promise<SubmitReceipt>,
    abort: (sessionId) => void bridge.command({ verb: "abort", sessionId }),
    clear: (sessionId) => void bridge.command({ verb: "clear", sessionId }),
    clearApproval: (sessionId, approvalId) =>
      void bridge.command({ verb: "clearApproval", sessionId, approvalId }),
    respondToApproval: (request, decision) =>
      bridge.command({
        verb: "respondToApproval",
        request,
        decision,
      }) as Promise<RuntimeActionResult>,
    respondToQuestions: (request, answers) =>
      bridge.command({
        verb: "respondToQuestions",
        request,
        answers,
      }) as Promise<RuntimeActionResult>,
    cancelQuestions: (request) =>
      bridge.command({
        verb: "cancelQuestions",
        request,
      }) as Promise<RuntimeActionResult>,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      bridge.dispose();
    },
  };

  return {
    engine,
    bridge,
    kill: () => {
      try {
        if (!disposed) child.kill();
      } catch {
        // Already gone.
      }
    },
  };
}
