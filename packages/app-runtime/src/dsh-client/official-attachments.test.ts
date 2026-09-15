import { afterEach, expect, it, vi } from "vitest";
import { bindOfficialAttachments, officialAttachments, type OfficialAttachmentController } from "./official-attachments.js";
import type { ComposerAttachment, ComposerAttachmentsOwner } from "@amiba/extension-sdk";
let dispose = () => {};
afterEach(() => dispose());
function fixture() {
  const drafts = new Map<string, ComposerAttachment>();
  let uploads: ComposerAttachmentsOwner["uploads"] = {};
  const listeners = new Set<() => void>();
  const publish = (value: typeof uploads) => { uploads = value; for (const listener of [...listeners]) listener(); };
  const controller: OfficialAttachmentController = {
    createDrafts: vi.fn((sessionId: string, files: readonly File[]) => files.map(file => {
      const id = crypto.randomUUID() as ComposerAttachment["id"];
      const draft: ComposerAttachment = { id, kind: "file", file };
      drafts.set(id, draft); publish({ ...uploads, [id]: { status: "uploading", loaded: 0 } }); return draft;
    })),
    resolveDraftAttachments: ids => ids.flatMap(id => drafts.has(id) ? [drafts.get(id)!] : []),
    serializeDraftAttachments: vi.fn(async (ids: readonly string[]) => ({ attachments: ids.map(id => {
      const upload = uploads[id]; if (upload?.status !== "ready") throw new Error("Not ready");
      return { type: "file" as const, receiptId: upload.receiptId };
    }) })),
    releaseDraftAttachment: vi.fn(id => { drafts.delete(id); const next = { ...uploads }; delete next[id]; publish(next); }),
    rebindDraftFiles: vi.fn((_session, ids) => { for (const id of ids) publish({ ...uploads, [id]: { status: "uploading", loaded: 0 } }); }),
    retryFileUpload: vi.fn(),
    fileUploads: { getSnapshot: () => uploads, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
  };
  const ensure = vi.fn(async () => {});
  dispose = bindOfficialAttachments(controller, ensure);
  const ready = (id: string, receiptId: string) => publish({ ...uploads, [id]: { status: "ready", receiptId: receiptId as never, file: { attachmentId: "sha256:test" as never, name: "notes.txt", bytes: 3 } } });
  return { controller, ensure, ready, publish, listeners };
}
const input = { sessionId: "first", name: "notes.txt", mime: "text/plain", bytes: new Uint8Array([97,98,99]) };
it("waits for official upload completion and sends its receipt without reading the bytes again", async () => {
  const f = fixture(); const draft = await officialAttachments.put(input);
  const sending = officialAttachments.serialize!("first", [draft.attachmentId]);
  expect(f.controller.serializeDraftAttachments).not.toHaveBeenCalled();
  f.ready(draft.attachmentId, "first-receipt");
  expect(await sending).toEqual([{ type: "file", receiptId: "first-receipt" }]);
  expect(f.controller.createDrafts).toHaveBeenCalledOnce();
  expect(f.listeners.size).toBe(0);
});
it("rebinds a carried draft to the receiving session instead of reusing a foreign receipt", async () => {
  const f = fixture(); const { attachmentId } = await officialAttachments.put(input);
  f.ready(attachmentId, "foreign");
  const sending = officialAttachments.serialize!("second", [attachmentId]);
  await vi.waitFor(() => expect(f.controller.rebindDraftFiles).toHaveBeenCalledWith("second", [attachmentId]));
  expect(f.controller.serializeDraftAttachments).not.toHaveBeenCalled();
  f.ready(attachmentId, "second-receipt");
  expect(await sending).toEqual([{ type: "file", receiptId: "second-receipt" }]);
});
it("abort stops waiting but preserves the official draft for retry", async () => {
  const f = fixture(); const { attachmentId } = await officialAttachments.put(input);
  const abort = new AbortController(); const sending = officialAttachments.serialize!("first", [attachmentId], abort.signal);
  abort.abort(); await expect(sending).rejects.toThrow();
  expect(f.listeners.size).toBe(0); expect(officialAttachments.drafts!([attachmentId])).toHaveLength(1);
  expect(f.controller.releaseDraftAttachment).not.toHaveBeenCalled();
});
it("removal releases only the official draft and missing old IDs never invoke a migration", async () => {
  const f = fixture(); const { attachmentId } = await officialAttachments.put(input);
  await officialAttachments.remove(attachmentId);
  expect(f.controller.releaseDraftAttachment).toHaveBeenCalledWith(attachmentId);
  await expect(officialAttachments.serialize!("", ["att_old"])).rejects.toThrow("attach the file again");
  expect(f.ensure).toHaveBeenCalledTimes(1);
});
