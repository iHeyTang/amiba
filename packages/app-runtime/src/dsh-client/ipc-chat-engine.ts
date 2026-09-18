/**
 * IPC transport for the shared chat engine.
 *
 * When the chat engine is hosted in the Electron MAIN process (one
 * `DshChatEngineClient` holding the app's single set of DSH connections),
 * renderers consume it through this thin surface instead of constructing
 * their own engine. The surface mirrors the engine's command verbs plus the
 * `EngineToClientMessage` push stream the protocol defines; the desktop
 * platform adapter wires it to `window.amiba.chatEngine` (preload), and the
 * ui-shell plugin falls back to a local engine when no hosted engine exists
 * (the web/runtime-less case).
 */

import type {
  AgentSubagentAddress,
} from "../platform/index.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatEngineClient,
  EngineToClientMessage,
  RuntimeActionResult,
  SubmitPayload,
  SubmitReceipt,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "../protocol/index.js";

/**
 * The preload bridge surface (`window.amiba.chatEngine`). Each command maps
 * to one IPC invoke; `onMessage` receives the engine's routed
 * `EngineToClientMessage` pushes for THIS window's subscribed sessions. The
 * two serialization hooks are optional: they only exist when the hosted
 * engine asks this window to resolve its local attachment drafts.
 */
export interface ChatEngineIpcSurface {
  subscribe(sessionId: string, subagent?: AgentSubagentAddress): void;
  unsubscribe(sessionId: string): void;
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
  cancelQuestions(
    request: UserQuestionRequest,
  ): Promise<RuntimeActionResult>;
  onMessage(cb: (msg: EngineToClientMessage) => void): () => void;
  /** Host asks this window to serialize local attachment draft ids. */
  onSerializeRequest?(cb: (request: ChatEngineBridgeRequest) => void): () => void;
  respondSerialize(
    requestId: string,
    ok: boolean,
    parts: import("./index.js").DshPromptContentPart[],
    error?: string,
  ): void;
}

/** One-shot renderer→host request (draft serialization). */
export interface ChatEngineBridgeRequest {
  requestId: string;
  sessionId: string;
  ids: string[];
}

/** Build a `ChatEngineClient` from the preload surface. */
export function createIpcChatEngineClient(
  surface: ChatEngineIpcSurface,
): ChatEngineClient {
  return {
    subscribe: (sessionId) => surface.subscribe(sessionId),
    requestSnapshot: (sessionId) => surface.requestSnapshot(sessionId),
    submit: (payload) => surface.submit(payload),
    submitWithReceipt: (payload) => surface.submitWithReceipt(payload),
    abort: (sessionId) => surface.abort(sessionId),
    clear: (sessionId) => surface.clear(sessionId),
    clearApproval: (sessionId, approvalId) =>
      surface.clearApproval(sessionId, approvalId),
    respondToApproval: (request, decision) =>
      surface.respondToApproval(request, decision),
    respondToQuestions: (request, answers) =>
      surface.respondToQuestions(request, answers),
    cancelQuestions: (request) => surface.cancelQuestions(request),
    onSnapshot: (cb) =>
      surface.onMessage((msg) => {
        if (msg.type === "snapshot") cb(msg);
      }),
    onStreamEvent: (cb) =>
      surface.onMessage((msg) => {
        if (msg.type === "event") cb(msg.sessionId, msg.event);
      }),
    dispose: () => {},
  };
}