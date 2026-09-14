import type { ComposerAttachment, ComposerAttachmentsOwner } from "@amiba/extension-sdk";
import type { AgentAttachmentsAdapter } from "../platform/index.js";
import type { DshPromptContentPart } from "./index.js";

/** Structural boundary: the implementation is DSH's published ConversationController. */
export interface OfficialAttachmentController {
  createDrafts(sessionId: string, files: readonly File[]): readonly ComposerAttachment[];
  resolveDraftAttachments(ids: readonly string[]): readonly ComposerAttachment[];
  serializeDraftAttachments(ids: readonly string[]): Promise<{ attachments: readonly DshPromptContentPart[] }>;
  releaseDraftAttachment(id: string): void;
  rebindDraftFiles(sessionId: string, ids: readonly string[]): void;
  retryFileUpload(sessionId: string, id: string): void;
  fileUploads: {
    getSnapshot(): ComposerAttachmentsOwner["uploads"];
    subscribe(listener: () => void): () => void;
  };
}
type Binding = { controller: OfficialAttachmentController; ensureSession(id: string): Promise<void> };
const key = Symbol.for("@amiba/official-attachment-drafts");
const registry = globalThis as unknown as Record<symbol, { active?: Binding; sessions: Map<string, string> }>;
const state = registry[key] ??= { sessions: new Map() };
const sessions = state.sessions;
export function bindOfficialAttachments(controller: OfficialAttachmentController, ensureSession: (id: string) => Promise<void>): () => void {
  const binding = { controller, ensureSession };
  state.active = binding;
  return () => { if (state.active === binding) { state.active = undefined; sessions.clear(); } };
}
function binding() {
  if (!state.active) throw new Error("Official attachment service is not ready.");
  return state.active;
}
function waitForUploads(controller: OfficialAttachmentController, ids: readonly string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const done = (error?: unknown) => { off(); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
    const abort = () => done(signal?.reason ?? new Error("Upload cancelled"));
    const check = () => {
      if (signal?.aborted) return abort();
      const drafts = controller.resolveDraftAttachments(ids);
      if (drafts.length !== ids.length) return done(new Error("Attachment draft is no longer available. Please attach the file again."));
      const uploads = controller.fileUploads.getSnapshot();
      for (const draft of drafts) {
        if (draft.kind === "image") continue;
        const upload = uploads[draft.id];
        if (upload?.status === "error") return done(new Error(upload.message ?? "File upload failed."));
        if (upload?.status !== "ready") return;
      }
      done();
    };
    off = controller.fileUploads.subscribe(check);
    signal?.addEventListener("abort", abort, { once: true });
    check();
  });
}
/** No Amiba object store: IDs and bytes belong to the official browser draft registry. */
export const officialAttachments: AgentAttachmentsAdapter = {
  drafts: ids => state.active?.controller.resolveDraftAttachments(ids) ?? [],
  uploadState: () => state.active?.controller.fileUploads.getSnapshot() ?? {},
  subscribe: listener => state.active?.controller.fileUploads.subscribe(listener) ?? (() => {}),
  retry(id) { const sessionId = sessions.get(id); if (sessionId) binding().controller.retryFileUpload(sessionId, id); },
  async put(input) {
    const { controller, ensureSession } = binding();
    await ensureSession(input.sessionId);
    const [draft] = controller.createDrafts(input.sessionId, [new File([new Uint8Array(input.bytes)], input.name, { type: input.mime })]);
    if (!draft) throw new Error("Unable to create attachment draft.");
    sessions.set(draft.id, input.sessionId);
    return { attachmentId: draft.id };
  },
  async serialize(sessionId, ids, signal) {
    const { controller, ensureSession } = binding();
    if (sessionId) {
      const moved = ids.filter(id => sessions.get(id) !== sessionId);
      if (moved.length) {
        await ensureSession(sessionId);
        signal?.throwIfAborted();
        controller.rebindDraftFiles(sessionId, moved);
        for (const id of moved) sessions.set(id, sessionId);
      }
    }
    await waitForUploads(controller, ids, signal);
    const result = await controller.serializeDraftAttachments(ids);
    signal?.throwIfAborted();
    return [...result.attachments];
  },
  async remove(id) {
    state.active?.controller.releaseDraftAttachment(id);
    sessions.delete(id);
  },
};
