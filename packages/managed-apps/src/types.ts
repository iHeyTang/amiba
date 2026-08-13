export type ManagedAppKind =
  | "static-content"
  | "interactive-ui"
  | "tool-app"
  | "registered-mcp"

export type ManagedAppRuntime = "static-mcp-app" | "node" | "python" | "registered"

export type ManagedAppUserStatus =
  | "creating"
  | "ready"
  | "improving"
  | "preview-ready"
  | "needs-confirmation"
  | "update-failed"
  | "unavailable"

export type ManagedAppRevisionStatus =
  | "candidate"
  | "previewing"
  | "awaiting-confirmation"
  | "activating"
  | "healthy"
  | "failed"
  | "rolled-back"

export interface ManagedAppProviderManifest {
  alias: string
  kind: "bundled" | "registered"
  runtime?: "node" | "python"
  entry?: string
  command?: string
  args?: string[]
  transport?: "stdio" | "streamable-http"
  url?: string
  providerId?: string
  version?: string
}

export interface ManagedAppSurfaceManifest {
  provider?: string
  resourceUri: string
  /** Static MCP Apps fallback. Relative to the project root. */
  entry?: string
}

export interface ManagedAppManifest {
  $schema?: string
  schemaVersion: 1
  id: string
  name: string
  description?: string
  icon?: string
  kind: ManagedAppKind
  runtime: ManagedAppRuntime
  mcp?: {
    providers: ManagedAppProviderManifest[]
  }
  surfaces?: {
    main?: ManagedAppSurfaceManifest
    settings?: ManagedAppSurfaceManifest
  }
  mentions?: Array<{
    id: string
    provider: string
    label: string
    icon?: string
    resourceUriTemplate?: string
    searchTool?: string
  }>
  permissions?: string[]
  dataSchemaVersion?: number
  build?: {
    commands?: string[][]
    testCommands?: string[][]
    outputDir?: string
  }
}

export interface ManagedAppRevision {
  id: string
  extensionId: string
  parentRevisionId?: string
  sourceCommit: string
  bundleHash: string
  manifest: ManagedAppManifest
  capabilities: ManagedAppCapabilitySnapshot
  permissions: string[]
  dataSchemaVersion: number
  userRequest: string
  changeSummary: string
  sourceSessionId?: string
  risk: "safe" | "sensitive"
  status: ManagedAppRevisionStatus
  createdAt: string
  activatedAt?: string
  error?: string
}

export interface ManagedAppDraft {
  id: string
  extensionId: string
  baseRevisionId?: string
  workspacePath: string
  branch: string
  userRequest: string
  sourceSessionId?: string
  status: "editing" | "building" | "preview-ready" | "failed" | "applied" | "discarded"
  createdAt: string
  updatedAt: string
  error?: string
  candidateRevisionId?: string
}

export interface ManagedAppState {
  schemaVersion: 1
  id: string
  name: string
  description?: string
  icon?: string
  kind: ManagedAppKind
  source: "personal-managed"
  tags: string[]
  collectionId?: string
  sourceSessionIds: string[]
  pinned: boolean
  archived: boolean
  deletedAt?: string
  projectPath: string
  activeRevisionId?: string
  pendingDraftId?: string
  revisionIds: string[]
  userStatus: ManagedAppUserStatus
  lastError?: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface ManagedAppSummary {
  id: string
  name: string
  description?: string
  icon?: string
  kind: ManagedAppKind
  source: "personal-managed"
  tags: string[]
  collectionId?: string
  sourceSessionIds: string[]
  pinned: boolean
  archived: boolean
  deletedAt?: string
  userStatus: ManagedAppUserStatus
  activeRevisionId?: string
  pendingDraft?: ManagedAppDraft
  activeRevision?: ManagedAppRevision
  candidateRevision?: ManagedAppRevision
  latestChangeSummary?: string
  lastError?: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface ManagedAppCreateRequest {
  name: string
  description?: string
  request: string
}

export interface ManagedAppCreateResult {
  app: ManagedAppSummary
  draft: ManagedAppDraft
  agentPrompt: string
}

export interface ManagedAppChangeResult {
  draft: ManagedAppDraft
  agentPrompt: string
}

export interface ManagedAppMetadataPatch {
  tags?: string[]
  collectionId?: string | null
  pinned?: boolean
}

export interface ManagedAppAgentResultFile {
  status: "ready" | "failed"
  summary?: string
  error?: string
}

export interface ManagedAppCapabilitySnapshot {
  tools: Array<{
    name: string
    description?: string
    inputSchema?: Record<string, unknown>
    _meta?: Record<string, unknown>
  }>
  resources: Array<{
    uri: string
    name?: string
    description?: string
    mimeType?: string
    _meta?: Record<string, unknown>
  }>
  resourceTemplates: Array<{
    uriTemplate: string
    name?: string
    description?: string
    mimeType?: string
    _meta?: Record<string, unknown>
  }>
  prompts: Array<{ name: string; description?: string }>
}

export interface ManagedAppSurfaceDocument {
  appId: string
  revisionId: string
  resourceUri: string
  mimeType: string
  html?: string
  assetUrl?: string
  metadata?: Record<string, unknown>
}

export interface ManagedAppOutputRecord {
  id: string
  extensionId: string
  revisionId: string
  kind: "file" | "image" | "document" | "resource"
  uri: string
  name: string
  mimeType?: string
  toolName?: string
  tags: string[]
  pinned: boolean
  createdAt: string
}

export interface ManagedAppToolPreset {
  id: string
  extensionId: string
  revisionId: string
  providerAlias: string
  toolName: string
  name: string
  arguments: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ManagedAppOutputInput {
  revisionId: string
  kind?: ManagedAppOutputRecord["kind"]
  uri: string
  name: string
  mimeType?: string
  toolName?: string
}

export type ManagedAppChangeListener = (appId: string | null) => void
