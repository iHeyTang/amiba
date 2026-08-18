import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type { ToolSourceDescriptor } from "./provenance.js";

export interface ToolSchemaView {
  name: string;
  description?: string;
  parameters: unknown;
  source: ToolSourceDescriptor;
}

export interface ToolInventory {
  tools: ToolSchemaView[];
}

const sourceSchema = z.object({
  kind: z.enum(["dsh-core", "dsh-plugin", "mcp-server"]),
  id: z.string(),
  name: z.string(),
  packageName: z.string().optional(),
  loadMode: z.enum(["core", "plugin", "mcp"]),
  executionTarget: z.enum([
    "dsh-runtime",
    "desktop-service",
    "external-process",
  ]),
  dynamic: z.boolean(),
  provider: z.string().optional(),
});

const inventorySchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.unknown(),
      source: sourceSchema,
    }),
  ),
});

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaTools: {
      list(): Promise<RemoteResult<ToolInventory>>;
    };
  }

  interface TypertRemoteMap {
    "amibaTools/list": () => Promise<RemoteResult<ToolInventory>>;
  }
}

/** Strict Client descriptor for the catalog's DSH Typert Remote face. */
export const AMIBA_TOOLS_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-catalog",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-catalog#amibaTools/list",
      service: "amibaTools",
      namespace: "amibaTools",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/tools#inventory",
        schema: inventorySchema,
      },
    },
  ],
};
