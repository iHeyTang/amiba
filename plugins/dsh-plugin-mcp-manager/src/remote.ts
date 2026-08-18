import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  McpSaveInput,
  McpServerView,
} from "./manager.js";

const stringMapSchema = z.record(z.string(), z.string());
const serverSchema = z.object({
  serverName: z.string(),
  transport: z.enum(["stdio", "streamable-http"]),
  enabled: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
});
const inputSchema = z.object({
  serverName: z.string(),
  transport: z.enum(["stdio", "streamable-http"]),
  enabled: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  env: stringMapSchema.optional(),
  headers: stringMapSchema.optional(),
});
const snapshotSchema = z.object({
  servers: z.array(serverSchema),
  toolsOnly: z.literal(true),
});
const savedSchema = z.object({ server: serverSchema });
const removedSchema = z.object({
  serverName: z.string(),
  deleted: z.boolean(),
});
const inputCodec = {
  mode: "strict" as const,
  typeSymbol: "@amiba/mcp#save-input",
  schema: inputSchema,
};
const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMcp: {
      list(): Promise<
        RemoteResult<{ servers: McpServerView[]; toolsOnly: true }>
      >;
      save(input: McpSaveInput): Promise<RemoteResult<{ server: McpServerView }>>;
      removeServer(
        serverName: string,
      ): Promise<RemoteResult<{ serverName: string; deleted: boolean }>>;
    };
  }

  interface TypertRemoteMap {
    "amibaMcp/list": () => Promise<
      RemoteResult<{ servers: McpServerView[]; toolsOnly: true }>
    >;
    "amibaMcp/save": (
      input: McpSaveInput,
    ) => Promise<RemoteResult<{ server: McpServerView }>>;
    "amibaMcp/removeServer": (
      serverName: string,
    ) => Promise<RemoteResult<{ serverName: string; deleted: boolean }>>;
  }
}

export const AMIBA_MCP_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-mcp-manager",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-mcp-manager#amibaMcp/list",
      service: "amibaMcp",
      namespace: "amibaMcp",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/mcp#snapshot",
        schema: snapshotSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-mcp-manager#amibaMcp/save",
      service: "amibaMcp",
      namespace: "amibaMcp",
      method: "save",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: inputCodec,
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/mcp#saved",
        schema: savedSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-mcp-manager#amibaMcp/removeServer",
      service: "amibaMcp",
      namespace: "amibaMcp",
      method: "removeServer",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "serverName",
          wire: "serverName",
          source: "json",
          codec: stringCodec,
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/mcp#removed",
        schema: removedSchema,
      },
    },
  ],
};
