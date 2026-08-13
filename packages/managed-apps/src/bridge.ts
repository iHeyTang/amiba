import type {
  ManagedAppChangeResult,
  ManagedAppCreateRequest,
  ManagedAppCreateResult,
  ManagedAppOutputRecord,
  ManagedAppSummary,
  ManagedAppSurfaceDocument,
  ManagedAppToolPreset,
} from "./types"

export interface ManagedAppsToolResult {
  content: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export interface ManagedAppsResourceResult {
  contents: Array<{
    uri: string
    mimeType?: string
    text?: string
    blob?: string
    _meta?: Record<string, unknown>
  }>
  _meta?: Record<string, unknown>
}

export interface ManagedAppsBridge {
  list(options?: { includeArchived?: boolean }): Promise<ManagedAppSummary[]>
  get(appId: string): Promise<ManagedAppSummary | null>
  create(request: ManagedAppCreateRequest): Promise<ManagedAppCreateResult>
  requestChange(appId: string, request: string): Promise<ManagedAppChangeResult>
  attachSession(appId: string, draftId: string, sessionId: string): Promise<void>
  updateMetadata(
    appId: string,
    patch: import("./types").ManagedAppMetadataPatch,
  ): Promise<ManagedAppSummary>
  archive(appId: string): Promise<ManagedAppSummary>
  restore(appId: string): Promise<ManagedAppSummary>
  exportProject(appId: string): Promise<string | null>
  listOutputs(appId: string): Promise<ManagedAppOutputRecord[]>
  updateOutput(
    appId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ): Promise<ManagedAppOutputRecord>
  listPresets(appId: string): Promise<ManagedAppToolPreset[]>
  savePreset(appId: string, input: {
    revisionId: string
    providerAlias: string
    toolName: string
    name: string
    arguments: Record<string, unknown>
  }): Promise<ManagedAppToolPreset>
  deletePreset(appId: string, presetId: string): Promise<void>
  confirm(appId: string, revisionId: string): Promise<ManagedAppSummary>
  reject(appId: string, revisionId: string): Promise<ManagedAppSummary>
  rollback(appId: string): Promise<ManagedAppSummary>
  markUsed(appId: string): Promise<void>
  surface(
    appId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ): Promise<ManagedAppSurfaceDocument | null>
  callTool(input: {
    appId: string
    providerAlias: string
    name: string
    arguments?: Record<string, unknown>
    revisionId?: string
  }): Promise<ManagedAppsToolResult>
  readResource(input: {
    appId: string
    providerAlias: string
    uri: string
    revisionId?: string
  }): Promise<ManagedAppsResourceResult>
  onChanged(listener: (appId: string | null) => void): () => void
}
