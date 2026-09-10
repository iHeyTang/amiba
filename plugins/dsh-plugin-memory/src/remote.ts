import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { MemosStatus } from "./memos-status.js";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMemory: { status(): Promise<RemoteResult<MemosStatus>> };
  }
  interface TypertRemoteMap {
    "amibaMemory/status": () => Promise<RemoteResult<MemosStatus>>;
  }
}

export const AMIBA_MEMORY_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-memory",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-memory#amibaMemory/status",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "status",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-memory#MemosStatus",
        schema: z.object({
          engine: z.literal("memos"),
          version: z.string(),
          state: z.enum(["starting", "ready", "error", "stopped"]),
          mode: z.enum(["full", "lightweight"]),
          home: z.string(),
          viewerUrl: z.string().nullable(),
          error: z.string().nullable(),
        }),
      },
    },
  ],
};
