import type {
  ManagedExtensionCapabilitySnapshot,
  ManagedExtensionManifest,
  ManagedExtensionRevision,
} from "@amiba/managed-extensions/types"

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

export interface PreparedManagedExtension {
  extensionId: string
  revision: ManagedExtensionRevision
  manifest: ManagedExtensionManifest
  bundlePath: string
  capabilities: ManagedExtensionCapabilitySnapshot
}

export interface ManagedMcpRuntime {
  discover(opts: {
    extensionId: string
    projectPath: string
    manifest: ManagedExtensionManifest
  }): Promise<ManagedExtensionCapabilitySnapshot>
  prepare(opts: {
    extensionId: string
    revision: ManagedExtensionRevision
    bundlePath: string
  }): Promise<PreparedManagedExtension>
  activate(opts: {
    extensionId: string
    revision: ManagedExtensionRevision
    previous?: ManagedExtensionRevision
    bundlePath: string
  }): Promise<void>
  deactivate(extensionId: string): Promise<void>
  discardPrepared(extensionId: string, revisionId: string): Promise<void>
  listActive(): PreparedManagedExtension[]
  callTool(extensionId: string, providerAlias: string, name: string, args?: Record<string, unknown>): Promise<McpToolResult>
  callPreparedTool(
    extensionId: string,
    revisionId: string,
    providerAlias: string,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolResult>
  readResource(extensionId: string, providerAlias: string, uri: string): Promise<McpResourceResult>
  readPreparedResource(
    extensionId: string,
    revisionId: string,
    providerAlias: string,
    uri: string,
  ): Promise<McpResourceResult>
  close(): Promise<void>
  onCapabilitiesChanged(listener: () => void): () => void
}

export interface McpAppsViewBridge {
  callTool(input: {
    extensionId: string
    providerAlias: string
    name: string
    arguments?: Record<string, unknown>
  }): Promise<McpToolResult>
  readResource(input: {
    extensionId: string
    providerAlias: string
    uri: string
  }): Promise<McpResourceResult>
  openLink(url: string): Promise<void>
  sendMessage(text: string): Promise<void>
}
