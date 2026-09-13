import { formatFileAttachmentsForPrompt, normalizeAgentContext, type SessionMessage, type SessionMeta } from "@amiba/app-runtime/core";
import type { SubmitPayload, SubmitReceipt } from "@amiba/app-runtime/protocol";
import { shortId } from "@amiba/app-runtime/utils";
import type { ResidentTurnRequest } from "../composer/triggers/contracts";
import { withSendingAttachments } from "./attachment-ownership";

export interface ResidentTurnPlan {
  payload: SubmitPayload;
  messages: SessionMessage[];
  workspacePath?: string;
}
export interface ResidentTurnSenderDeps {
  unavailable(id: string): boolean;
  prepare(id: string): Promise<string>;
  read(id: string): Promise<{ session: SessionMeta; messages: SessionMessage[] }>;
  workspace(id: string): Promise<string | undefined>;
  checkpoint(id: string, turnIndex: number): Promise<void>;
  markdown(id: string): Promise<void>;
  dispatch(plan: ResidentTurnPlan): Promise<SubmitReceipt>;
}

/** Target-addressed backend only. Input adjudication and consumption belong to its caller. */
export function createResidentTurnSender(deps: ResidentTurnSenderDeps) {
  const preparing = new Set<string>();
  return async (request: ResidentTurnRequest): Promise<SubmitReceipt> => {
    request = { ...request, attachments: request.attachments.map(item => ({ ...item })) };
    let dispatched = false;
    const held = new Set<string>();
    const check = (id: string) => {
      request.signal?.throwIfAborted();
      if (!id || deps.unavailable(id)) throw new Error("The target conversation is no longer available for background submission.");
    };
    const hold = (id: string) => {
      check(id);
      if (held.has(id)) return;
      if (preparing.has(id)) throw new Error("This conversation already has a submission in preparation.");
      preparing.add(id); held.add(id);
    };
    try {
      hold(request.sessionId);
      if (!request.text.trim() && !request.attachments.length) throw new Error("The input is empty.");
      if (request.attachments.some(item => item.uploading || !item.attachmentId)) throw new Error("Input attachments are not ready.");
      return await withSendingAttachments([...request.attachments], async () => {
        const target = await deps.prepare(request.sessionId);
        check(request.sessionId); hold(target);
        const { session, messages } = await deps.read(target);
        check(target);
        if (session.id !== target) throw new Error("The target conversation identity changed.");
        if (session.subagentAddress?.mode === "one-shot") throw new Error("This conversation is read-only.");
        if (session.subagentAddress && request.attachments.some(item => item.kind === "image")) {
          throw new Error("The installed DSH client does not support images in child conversation continuations.");
        }
        const workspacePath = await deps.workspace(target);
        check(target);
        const payload: SubmitPayload = {
          sessionId: target, sessionTitle: session.title,
          assistantUiId: shortId("a"), agent: normalizeAgentContext(session.agent),
          history: [...messages.map(({ role, content, name }) => ({ role, content, ...(name ? { name } : {}) })), { role: "user", content: request.text }],
          ...(request.attachments.length ? {
            attachmentPrompt: formatFileAttachmentsForPrompt([...request.attachments]),
            attachments: request.attachments.map(item => ({ name: item.name, mime: item.mime, size: item.size, kind: item.kind, attachmentId: item.attachmentId! })),
          } : {}),
        };
        await deps.checkpoint(target, messages.filter(item => item.role === "user").length);
        check(target);
        await deps.markdown(target);
        check(target); check(request.sessionId);
        request.onDispatch?.(target);
        dispatched = true;
        return deps.dispatch({ payload, messages, workspacePath });
      });
    } catch (error) {
      return { kind: dispatched ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : String(error) };
    } finally {
      for (const id of held) preparing.delete(id);
    }
  };
}
