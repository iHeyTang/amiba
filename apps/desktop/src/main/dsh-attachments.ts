import { lstat, readFile } from "node:fs/promises";

import type { AgentAttachmentsAdapter } from "@amiba/app-runtime/platform";

import { dshRuntime } from "./dsh-runtime";

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function kindOf(mime: string): "image" | "text" | "pdf" {
  const normalized = mime.toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (normalized.startsWith("image/")) return "image";
  return "text";
}

/**
 * Temporary native-client facade over the DSH attachment plugin. Electron may
 * read a user-selected source file, but it never owns the durable object and
 * never exposes a filesystem-delete primitive to a renderer.
 */
export const dshAttachments: AgentAttachmentsAdapter & {
  importFile(input: {
    sessionId: string;
    name: string;
    mime: string;
    path: string;
  }): Promise<{ attachmentId: string; size: number }>;
} = {
  async put(input) {
    if (!(input.bytes instanceof Uint8Array)) {
      throw new Error("Attachment bytes are invalid.");
    }
    if (input.bytes.byteLength <= 0) throw new Error("Attachment is empty.");
    if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment exceeds the 50 MB limit.");
    }
    const { client } = await dshRuntime.ensureStarted();
    return client.call("amibaAttachments/put", {
      args: {
        name: input.name,
        mime: input.mime,
        kind: kindOf(input.mime),
        dataBase64: Buffer.from(input.bytes).toString("base64"),
      },
    });
  },

  async readForPrompt(attachmentId) {
    const { client } = await dshRuntime.ensureStarted();
    return client.call("amibaAttachments/readForPrompt", {
      args: { attachmentId },
    });
  },

  async remove(attachmentId) {
    const { client } = await dshRuntime.ensureStarted();
    await client.call("amibaAttachments/removeAttachment", {
      args: { attachmentId },
    });
  },

  async importFile(input) {
    const info = await lstat(input.path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("External attachment target is not a regular file.");
    }
    if (info.size <= 0 || info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment size is outside the 1 byte–50 MB limit.");
    }
    const staged = await this.put({
      sessionId: input.sessionId,
      name: input.name,
      mime: input.mime,
      bytes: await readFile(input.path),
    });
    return { ...staged, size: info.size };
  },
};
