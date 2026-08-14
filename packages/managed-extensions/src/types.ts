import type {
  ExtensionIdentity,
  ExtensionSource,
} from "@amiba/extension-api"

export type ManagedExtensionKind =
  | "static-content"
  | "interactive-ui"
  | "tool-app"
  | "registered-mcp"

export type ManagedExtensionRuntime = "static-mcp-app" | "node" | "python" | "registered"

export type ManagedExtensionUserStatus =
  | "creating"
  | "ready"
  | "improving"
  | "preview-ready"
  | "needs-confirmation"
  | "update-failed"
  | "unavailable"

export type ManagedExtensionRevisionStatus =
  | "candidate"
  | "previewing"
  | "awaiting-confirmation"
  | "activating"
  | "healthy"
  | "failed"
  | "rolled-back"

export interface ManagedExtensionProviderManifest {
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

export interface ManagedExtensionSurfaceManifest {
  provider?: string
  resourceUri: string
  /** Static MCP Apps fallback. Relative to the project root. */
  entry?: string
}

export interface ManagedExtensionManifest extends ExtensionIdentity {
  $schema?: string
  schemaVersion: 1
  kind: ManagedExtensionKind
  runtime: ManagedExtensionRuntime
  mcp?: {
    providers: ManagedExtensionProviderManifest[]
  }
  surfaces?: {
    main?: ManagedExtensionSurfaceManifest
    settings?: ManagedExtensionSurfaceManifest
  }
  mentions?: Array<{
    id: string
    provider: string
    label: string
    icon?: string
    resourceUriTemplate?: string
    searchTool?: string
  }>
  /** Hermes plugins required by this Extension's Agent-facing capabilities. */
  hermesPlugins?: Array<{
    id: string
    version?: string
    required?: boolean
  }>
  permissions?: string[]
  dataSchemaVersion?: number
  build?: {
    commands?: string[][]
    testCommands?: string[][]
    outputDir?: string
  }
}

export interface ManagedExtensionRevision {
  id: string
  extensionId: string
  parentRevisionId?: string
  sourceCommit: string
  bundleHash: string
  manifest: ManagedExtensionManifest
  capabilities: ManagedExtensionCapabilitySnapshot
  permissions: string[]
  dataSchemaVersion: number
  userRequest: string
  changeSummary: string
  sourceSessionId?: string
  risk: "safe" | "sensitive"
  status: ManagedExtensionRevisionStatus
  createdAt: string
  activatedAt?: string
  error?: string
}

export interface ManagedExtensionDraft {
  id: string
  extensionId: string
  baseRevisionId?: string
  workspacePath: string
  branch: string
  userRequest: string
  sourceSessionId?: string
  /** Stable caller-supplied key used to make retries idempotent. */
  operationId?: string
  status: "editing" | "building" | "preview-ready" | "failed" | "applied" | "discarded"
  createdAt: string
  updatedAt: string
  error?: string
  candidateRevisionId?: string
}

export interface ManagedExtensionState extends ExtensionIdentity {
  schemaVersion: 1
  kind: ManagedExtensionKind
  source: Extract<ExtensionSource, "personal-managed">
  tags: string[]
  collectionId?: string
  sourceSessionIds: string[]
  pinned: boolean
  archived: boolean
  deletedAt?: string
  projectPath: string
  /** Stable key for the user intent that created this Extension. */
  creationOperationId?: string
  /** Lets a retry return the original draft even after it has been applied. */
  initialDraftId?: string
  activeRevisionId?: string
  pendingDraftId?: string
  revisionIds: string[]
  userStatus: ManagedExtensionUserStatus
  lastError?: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface ManagedExtensionSummary extends ExtensionIdentity {
  kind: ManagedExtensionKind
  source: Extract<ExtensionSource, "personal-managed">
  tags: string[]
  collectionId?: string
  sourceSessionIds: string[]
  pinned: boolean
  archived: boolean
  deletedAt?: string
  userStatus: ManagedExtensionUserStatus
  activeRevisionId?: string
  pendingDraft?: ManagedExtensionDraft
  activeRevision?: ManagedExtensionRevision
  candidateRevision?: ManagedExtensionRevision
  latestChangeSummary?: string
  lastError?: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface ManagedExtensionCreateRequest {
  name: string
  description?: string
  request: string
  /** Reuse this value when retrying the same user request. */
  operationId?: string
}

export interface ManagedExtensionCreateResult {
  extension: ManagedExtensionSummary
  draft: ManagedExtensionDraft
  agentPrompt: string
}

export interface ManagedExtensionChangeResult {
  draft: ManagedExtensionDraft
  agentPrompt: string
}

export interface ManagedExtensionMetadataPatch {
  tags?: string[]
  collectionId?: string | null
  pinned?: boolean
}

export interface ManagedExtensionAgentResultFile {
  status: "ready" | "failed"
  summary?: string
  error?: string
}

export interface ManagedExtensionCapabilitySnapshot {
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

export interface ManagedExtensionSurfaceDocument {
  extensionId: string
  revisionId: string
  resourceUri: string
  mimeType: string
  html?: string
  assetUrl?: string
  metadata?: Record<string, unknown>
}

export interface ManagedExtensionOutputRecord {
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

export interface ManagedExtensionToolPreset {
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

export interface ManagedExtensionOutputInput {
  revisionId: string
  kind?: ManagedExtensionOutputRecord["kind"]
  uri: string
  name: string
  mimeType?: string
  toolName?: string
}

export type ManagedExtensionChangeListener = (extensionId: string | null) => void
