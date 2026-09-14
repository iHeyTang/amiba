import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { AmibaAttachmentKind, AmibaAttachmentStore } from "./attachment-store.js";

class AmibaAttachmentsRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly store: AmibaAttachmentStore,
  ) {
    super(ctx, "amibaAttachments");
  }

  @Remote
  put(name: string, mime: string, kind: AmibaAttachmentKind, dataBase64: string) {
    return this.store.put({ name, mime, kind, dataBase64 });
  }

  @Remote
  async readForPrompt(attachmentId: string) {
    const stored = await this.store.read(attachmentId);
    return {
      attachmentId: stored.attachmentId,
      name: stored.name,
      mime: stored.mime,
      size: stored.size,
      kind: stored.kind,
      dataBase64: Buffer.from(stored.data).toString("base64"),
    };
  }

  @Remote
  async retainForSession(attachmentId: string, sessionId: string) {
    await this.store.retainForSession(attachmentId, sessionId);
    return { attachmentId, retained: true };
  }

  @Remote
  removeAttachment(attachmentId: string) {
    return this.store.remove(attachmentId);
  }
}

export function applyAttachmentsRemote(ctx: Context, store: AmibaAttachmentStore): void {
  new AmibaAttachmentsRemoteService(ctx, store);
}
