import type { McpDependencyView } from "./dependencies.js";
import type { McpAccessView } from "./access.js";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type { McpSaveInput, McpServerView } from "./manager.js";

const stringMapSchema = z.record(z.string(), z.string());
const accessListSchema = z.array(z.object({
  id: z.string(), plugin: z.string(), name: z.string(), serviceId: z.string(), version: z.string(),
  audience: z.enum(["plugin", "ordinary-agents"]),
  tools: z.array(z.object({ name: z.string(), title: z.string(), description: z.string().optional() })),
  connectionId: z.string().optional(),
  connectionName: z.string().optional(),
  configuration: z.object({ ownerId: z.string(), recordId: z.string() }).optional(),
  connections: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string(), approvalToken: z.string(), configuration: z.object({ ownerId: z.string(), recordId: z.string() }).optional() })),
  state: z.enum(["approval-required", "waiting", "connecting", "ready", "error", "inactive"]), code: z.string().optional(),
}));
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
  dependencies: z.array(
    z.object({
      connectionId: z.string(),
      name: z.string(),
      service: z.string(),
      provider: z.string(),
      consumers: z.array(z.string()),
      instances: z.number(),
      state: z.enum(["available", "in-use", "error"]),
    }),
  ),
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
      listAccess(): Promise<RemoteResult<McpAccessView[]>>;
      approveAccess(id: string, connectionId: string, approvalToken: string): Promise<RemoteResult<McpAccessView[]>>;
      revokeAccess(id: string): Promise<RemoteResult<McpAccessView[]>>;
      retryAccess(id: string): Promise<RemoteResult<McpAccessView[]>>;
      list(): Promise<
        RemoteResult<{
          servers: McpServerView[];
          toolsOnly: true;
          dependencies: McpDependencyView[];
        }>
      >;
      save(
        input: McpSaveInput,
      ): Promise<RemoteResult<{ server: McpServerView }>>;
      removeServer(
        serverName: string,
      ): Promise<RemoteResult<{ serverName: string; deleted: boolean }>>;
    };
  }

  interface TypertRemoteMap {
    "amibaMcp/listAccess": () => Promise<RemoteResult<McpAccessView[]>>;
    "amibaMcp/approveAccess": (id: string, connectionId: string, approvalToken: string) => Promise<RemoteResult<McpAccessView[]>>;
    "amibaMcp/revokeAccess": (id: string) => Promise<RemoteResult<McpAccessView[]>>;
    "amibaMcp/retryAccess": (id: string) => Promise<RemoteResult<McpAccessView[]>>;
    "amibaMcp/list": () => Promise<
      RemoteResult<{
        servers: McpServerView[];
        toolsOnly: true;
        dependencies: McpDependencyView[];
      }>
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
    ...([ ["listAccess", []], ["approveAccess", ["id", "connectionId", "approvalToken"]], ["revokeAccess", ["id"]], ["retryAccess", ["id"]] ] as const).map(([method, parameters]) => ({
      id: `@amiba/dsh-plugin-mcp-manager#amibaMcp/${method}`,
      service: "amibaMcp", namespace: "amibaMcp", method,
      invocation: { kind: "direct" as const },
      parameters: parameters.map(name => ({ name, wire: name, source: "json" as const, codec: stringCodec })),
      result: { mode: "strict" as const, typeSymbol: "@amiba/mcp#access-list", schema: accessListSchema },
    })),
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
