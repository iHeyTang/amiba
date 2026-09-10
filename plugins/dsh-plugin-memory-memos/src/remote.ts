import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { MemosStatus } from "./memos-status.js";

import {
  memoryQuerySchema,
  memorySessionSchema,
  memoryPasswordSchema,
  memoryPageSchema,
  memoryOverviewSchema,
  type MemoryQuery,
  type MemoryPage,
  type MemoryOverview,
} from "./dashboard.js";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMemory: {
      status(): Promise<RemoteResult<MemosStatus>>;
      login(password: string): Promise<RemoteResult<string>>;
      overview(session?: string): Promise<RemoteResult<MemoryOverview>>;
      browse(input: MemoryQuery): Promise<RemoteResult<MemoryPage>>;
    };
  }
  interface TypertRemoteMap {
    "amibaMemory/login": (password: string) => Promise<RemoteResult<string>>;
    "amibaMemory/overview": (
      session?: string,
    ) => Promise<RemoteResult<MemoryOverview>>;
    "amibaMemory/browse": (
      input: MemoryQuery,
    ) => Promise<RemoteResult<MemoryPage>>;
    "amibaMemory/status": () => Promise<RemoteResult<MemosStatus>>;
  }
}

export const AMIBA_MEMORY_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-memory-memos",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-memory-memos#amibaMemory/login",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "login",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "password",
          wire: "password",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/memos#password",
            schema: memoryPasswordSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/memos#session",
        schema: memorySessionSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-memory-memos#amibaMemory/overview",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "overview",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "session",
          wire: "session",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/memos#optional-session",
            schema: memorySessionSchema.optional(),
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/memos#overview",
        schema: memoryOverviewSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-memory-memos#amibaMemory/browse",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "browse",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/memos#query",
            schema: memoryQuerySchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/memos#page",
        schema: memoryPageSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-memory-memos#amibaMemory/status",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "status",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-memory-memos#MemosStatus",
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
