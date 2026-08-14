import type {
  ManagedExtensionChangeResult,
  ManagedExtensionCreateRequest,
  ManagedExtensionCreateResult,
  ManagedExtensionOutputRecord,
  ManagedExtensionSummary,
  ManagedExtensionSurfaceDocument,
  ManagedExtensionToolPreset,
} from "./types"

export interface ManagedExtensionsToolResult {
  content: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export interface ManagedExtensionsResourceResult {
  contents: Array<{
    uri: string
    mimeType?: string
    text?: string
    blob?: string
    _meta?: Record<string, unknown>
  }>
  _meta?: Record<string, unknown>
}

export interface ManagedExtensionsBridge {
  list(options?: { includeArchived?: boolean }): Promise<ManagedExtensionSummary[]>
  get(extensionId: string): Promise<ManagedExtensionSummary | null>
  create(request: ManagedExtensionCreateRequest): Promise<ManagedExtensionCreateResult>
  requestChange(extensionId: string, request: string): Promise<ManagedExtensionChangeResult>
  abortDraft(extensionId: string, draftId: string, reason?: string): Promise<ManagedExtensionSummary | null>
  attachSession(extensionId: string, draftId: string, sessionId: string): Promise<void>
  updateMetadata(
    extensionId: string,
    patch: import("./types").ManagedExtensionMetadataPatch,
  ): Promise<ManagedExtensionSummary>
  archive(extensionId: string): Promise<ManagedExtensionSummary>
  restore(extensionId: string): Promise<ManagedExtensionSummary>
  exportProject(extensionId: string): Promise<string | null>
  listOutputs(extensionId: string): Promise<ManagedExtensionOutputRecord[]>
  updateOutput(
    extensionId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ): Promise<ManagedExtensionOutputRecord>
  listPresets(extensionId: string): Promise<ManagedExtensionToolPreset[]>
  savePreset(extensionId: string, input: {
    revisionId: string
    providerAlias: string
    toolName: string
    name: string
    arguments: Record<string, unknown>
  }): Promise<ManagedExtensionToolPreset>
  deletePreset(extensionId: string, presetId: string): Promise<void>
  confirm(extensionId: string, revisionId: string): Promise<ManagedExtensionSummary>
  reject(extensionId: string, revisionId: string): Promise<ManagedExtensionSummary>
  rollback(extensionId: string): Promise<ManagedExtensionSummary>
  markUsed(extensionId: string): Promise<void>
  surface(
    extensionId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ): Promise<ManagedExtensionSurfaceDocument | null>
  callTool(input: {
    extensionId: string
    providerAlias: string
    name: string
    arguments?: Record<string, unknown>
    revisionId?: string
  }): Promise<ManagedExtensionsToolResult>
  readResource(input: {
    extensionId: string
    providerAlias: string
    uri: string
    revisionId?: string
  }): Promise<ManagedExtensionsResourceResult>
  onChanged(listener: (extensionId: string | null) => void): () => void
}
