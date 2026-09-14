import type { ConversationController } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ComposerAttachment } from "@amiba/extension-sdk";

/** Existing input bridge names delegated to the official draft registry. */
export function createDraftImageRegistry(controller: ConversationController) {
  return {
    createDraftImages(files: readonly File[]) { return controller.createDrafts("" as never, files); },
    draftImages(ids: readonly ComposerAttachment["id"][]) { return controller.resolveDraftAttachments(ids); },
    async serializeDraftImages(ids: readonly ComposerAttachment["id"][]) { return (await controller.serializeDraftAttachments(ids)).attachments; },
    releaseDraftImage(id: ComposerAttachment["id"]) { controller.releaseDraftAttachment(id); },
    releaseDraftImages(attachments: readonly ComposerAttachment[]) { for (const item of attachments) controller.releaseDraftAttachment(item.id); },
    dispose() { /* Controller disposal follows its Cordis scope. */ },
  };
}
