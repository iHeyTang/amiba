import type {
  ManagedAppCapabilitySnapshot,
  ManagedAppManifest,
  ManagedAppRevision,
} from "@amiba/managed-apps/types"

export type McpContentBlock =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "image"; data: string; mimeType: string; [key: string]: unknown }
  | { type: "audio"; data: string; mimeType: string; [key: string]: unknown }
  | { type: "resource_link"; uri: string; name: string; [key: string]: unknown }
  | { type: "resource"; resource: Record<string, unknown>; [key: string]: unknown }

export interface McpToolResult {
  content: McpContentBlock[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export interface McpResourceResult {
  contents: Array<{
    uri: string
    mimeType?: string
    text?: string
    blob?: string
    _meta?: Record<string, unknown>
  }>
  _meta?: Record<string, unknown>
}

export interface PreparedManagedApp {
  appId: string
  revision: ManagedAppRevision
  manifest: ManagedAppManifest
  bundlePath: string
  capabilities: ManagedAppCapabilitySnapshot
}

export interface ManagedMcpRuntime {
  discover(opts: {
    appId: string
    projectPath: string
    manifest: ManagedAppManifest
  }): Promise<ManagedAppCapabilitySnapshot>
  prepare(opts: {
    appId: string
    revision: ManagedAppRevision
    bundlePath: string
  }): Promise<PreparedManagedApp>
  activate(opts: {
    appId: string
    revision: ManagedAppRevision
    previous?: ManagedAppRevision
    bundlePath: string
  }): Promise<void>
  deactivate(appId: string): Promise<void>
  discardPrepared(appId: string, revisionId: string): Promise<void>
  listActive(): PreparedManagedApp[]
  callTool(appId: string, providerAlias: string, name: string, args?: Record<string, unknown>): Promise<McpToolResult>
  callPreparedTool(
    appId: string,
    revisionId: string,
    providerAlias: string,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolResult>
  readResource(appId: string, providerAlias: string, uri: string): Promise<McpResourceResult>
  readPreparedResource(
    appId: string,
    revisionId: string,
    providerAlias: string,
    uri: string,
  ): Promise<McpResourceResult>
  close(): Promise<void>
  onCapabilitiesChanged(listener: () => void): () => void
}

export interface McpAppsViewBridge {
  callTool(input: {
    appId: string
    providerAlias: string
    name: string
    arguments?: Record<string, unknown>
  }): Promise<McpToolResult>
  readResource(input: {
    appId: string
    providerAlias: string
    uri: string
  }): Promise<McpResourceResult>
  openLink(url: string): Promise<void>
  sendMessage(text: string): Promise<void>
}
