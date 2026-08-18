import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  AmibaMemorySnapshot,
  AmibaMemoryTarget,
} from "./memory-store.js";

const entrySchema = z.object({
  id: z.string(),
  preset: z.string(),
  target: z.enum(["memory", "user"]),
  text: z.string(),
  flagged: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceSessionId: z.string().optional(),
});

const snapshotSchema = z.object({
  preset: z.string(),
  targets: z.array(
    z.object({
      target: z.enum(["memory", "user"]),
      path: z.string(),
      entries: z.array(entrySchema),
      charCount: z.number(),
      charLimit: z.number(),
      flaggedCount: z.number(),
    }),
  ),
});

const resetResultSchema = z.object({ deletedIds: z.array(z.string()) });
const presetIdsSchema = z.array(z.string());
const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMemory: {
      list(preset: string): Promise<RemoteResult<AmibaMemorySnapshot>>;
      presets(): Promise<RemoteResult<string[]>>;
      reset(
        preset: string,
        target: AmibaMemoryTarget | "all",
      ): Promise<RemoteResult<{ deletedIds: string[] }>>;
    };
  }

  interface TypertRemoteMap {
    "amibaMemory/list": (
      preset: string,
    ) => Promise<RemoteResult<AmibaMemorySnapshot>>;
    "amibaMemory/presets": () => Promise<RemoteResult<string[]>>;
    "amibaMemory/reset": (
      preset: string,
      target: AmibaMemoryTarget | "all",
    ) => Promise<RemoteResult<{ deletedIds: string[] }>>;
  }
}

/** Strict Client descriptor for the plugin's DSH Typert Remote face. */
export const AMIBA_MEMORY_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-memory",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-memory#amibaMemory/list",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "preset",
          wire: "preset",
          source: "json",
          codec: stringCodec,
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-memory#AmibaMemorySnapshot",
        schema: snapshotSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-memory#amibaMemory/presets",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "presets",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-memory#AmibaMemoryPresetIds",
        schema: presetIdsSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-memory#amibaMemory/reset",
      service: "amibaMemory",
      namespace: "amibaMemory",
      method: "reset",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "preset",
          wire: "preset",
          source: "json",
          codec: stringCodec,
        },
        {
          name: "target",
          wire: "target",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/dsh-plugin-memory#AmibaMemoryResetTarget",
            schema: z.enum(["memory", "user", "all"]),
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-memory#AmibaMemoryResetResult",
        schema: resetResultSchema,
      },
    },
  ],
};

