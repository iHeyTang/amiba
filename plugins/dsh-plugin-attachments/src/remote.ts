import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type { AmibaAttachmentKind, AmibaAttachmentRecord } from "./attachment-store.js";

export interface AmibaPromptAttachment extends AmibaAttachmentRecord {
  dataBase64: string;
}

const idSchema = z.string().regex(/^att_[0-9a-f]{32}$/u);
const kindSchema = z.enum(["image", "text", "pdf"]);
const recordSchema = z.object({
  attachmentId: idSchema,
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  kind: kindSchema,
  createdAt: z.string(),
});
const promptSchema = recordSchema.omit({ createdAt: true }).extend({ dataBase64: z.string() });

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaAttachments: {
      put(name: string, mime: string, kind: AmibaAttachmentKind, dataBase64: string): Promise<RemoteResult<AmibaAttachmentRecord>>;
      readForPrompt(attachmentId: string): Promise<RemoteResult<AmibaPromptAttachment>>;
      removeAttachment(attachmentId: string): Promise<RemoteResult<{ attachmentId: string; deleted: boolean }>>;
    };
  }
  interface TypertRemoteMap {
    "amibaAttachments/put": TypertRemoteNamespaceMap["amibaAttachments"]["put"];
    "amibaAttachments/readForPrompt": TypertRemoteNamespaceMap["amibaAttachments"]["readForPrompt"];
    "amibaAttachments/removeAttachment": TypertRemoteNamespaceMap["amibaAttachments"]["removeAttachment"];
  }
}

const stringCodec = { mode: "strict" as const, typeSymbol: "typescript#string", schema: z.string() };
function descriptor(method: string, parameters: TypertRemoteContribution["descriptors"][number]["parameters"], result: TypertRemoteContribution["descriptors"][number]["result"]) {
  return { id: `@amiba/dsh-plugin-attachments#amibaAttachments/${method}`, service: "amibaAttachments", namespace: "amibaAttachments", method, invocation: { kind: "direct" as const }, parameters, result };
}

export const AMIBA_ATTACHMENTS_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-attachments",
  descriptors: [
    descriptor("put", [
      { name: "name", wire: "name", source: "json", codec: stringCodec },
      { name: "mime", wire: "mime", source: "json", codec: stringCodec },
      { name: "kind", wire: "kind", source: "json", codec: { mode: "strict", typeSymbol: "@amiba/attachments#kind", schema: kindSchema } },
      { name: "dataBase64", wire: "dataBase64", source: "json", codec: stringCodec },
    ], { mode: "strict", typeSymbol: "@amiba/attachments#record", schema: recordSchema }),
    descriptor("readForPrompt", [
      { name: "attachmentId", wire: "attachmentId", source: "json", codec: { mode: "strict", typeSymbol: "@amiba/attachments#id", schema: idSchema } },
    ], { mode: "strict", typeSymbol: "@amiba/attachments#prompt", schema: promptSchema }),
    descriptor("removeAttachment", [
      { name: "attachmentId", wire: "attachmentId", source: "json", codec: { mode: "strict", typeSymbol: "@amiba/attachments#id", schema: idSchema } },
    ], { mode: "strict", typeSymbol: "@amiba/attachments#removed", schema: z.object({ attachmentId: idSchema, deleted: z.boolean() }) }),
  ],
};
