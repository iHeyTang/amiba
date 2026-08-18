/**
 * PlatformAdapter — runtime-independent capability surface consumed by shared
 * UI / business code. Each app (extension, desktop) provides its own
 * implementation at boot via `setPlatform()`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageChangeMap = Record<string, StorageChange>;

export interface StorageAdapter {
  get(keys?: string | string[]): Promise<Record<string, unknown>>;
  set(patch: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  /**
   * Subscribe to storage changes. `keys = undefined` means all keys.
   * Returns an unsubscribe function.
   */
  watch(
    keys: string | string[] | undefined,
    listener: (changes: StorageChangeMap) => void,
  ): () => void;
}

/** Runtime-owned durable session summary. Conversation data stays in the agent runtime. */
export interface AgentSessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  title?: string;
}

export interface AgentSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  surfaceOp?: unknown;
}

export interface AgentSessionHistoryEntry {
  event: AgentSessionEvent;
  view?: unknown;
}

/**
 * Runtime-neutral bridge to the canonical agent session log. The desktop
 * implementation delegates to DSH; web/remote surfaces can provide the same
 * contract without exposing a loopback runtime URL to untrusted UI code.
 */
export interface AgentSessionsAdapter {
  list(): Promise<AgentSessionSummary[]>;
  search(query: string): Promise<Array<{ sessionId: string; snippet: string }>>;
  create(input: {
    sessionId?: string;
    cwd?: string;
    workspaceId?: string;
    agentPreset?: string;
  }): Promise<{ sessionId: string; agentPreset?: string }>;
  history(
    sessionId: string,
    options?: { beforeSeq?: number; maxMessages?: number },
  ): Promise<{
    events: AgentSessionHistoryEntry[];
    hasMore: boolean;
    projections?: Record<string, unknown>;
  }>;
  rename(
    sessionId: string,
    title: string,
  ): Promise<{ title: string; seq: number }>;
  fork(sessionId: string, atSeq?: number): Promise<{ sessionId: string }>;
}

/** DSH-plugin-owned opaque attachment storage used by every client surface. */
export interface AgentAttachmentsAdapter {
  put(input: {
    sessionId: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<{ attachmentId: string }>;
  readForPrompt(attachmentId: string): Promise<{
    attachmentId: string;
    name: string;
    mime: string;
    size: number;
    kind: "image" | "text" | "pdf";
    dataBase64: string;
  }>;
  remove(attachmentId: string): Promise<void>;
}

export interface AgentWorkspaceEntry {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** DSH-owned workspace registry, ordering, session grouping, and archive set. */
export interface AgentWorkspacesAdapter {
  list(): Promise<{
    items: AgentWorkspaceEntry[];
    archivedSessionIds: string[];
  }>;
  create(path: string): Promise<{
    workspace: AgentWorkspaceEntry;
    created: boolean;
  }>;
  rename(
    workspaceId: string,
    title: string,
  ): Promise<{ workspace: AgentWorkspaceEntry }>;
  remove(workspaceId: string): Promise<void>;
  reorder(
    workspaceId: string,
    beforeWorkspaceId?: string,
  ): Promise<{ workspaceIds: string[] }>;
  reorderSession(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ): Promise<{ workspace: AgentWorkspaceEntry }>;
  archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }>;
}

export interface AgentPresetEntry {
  id: string;
  trust: "system" | "user";
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

/** DSH agent-composition roster and its deliberately narrow authoring surface. */
export interface AgentPresetsAdapter {
  list(): Promise<{
    presets: AgentPresetEntry[];
    authorable: boolean;
    hasDocument: boolean;
  }>;
  select(
    sessionId: string,
    agentPreset: string,
  ): Promise<{ agentPreset: string }>;
  read(agentPreset: string): Promise<{
    agentPreset: string;
    trust: "system" | "user";
    content: string;
    name?: string;
    description?: string;
  }>;
  copy(input: {
    from: string;
    agentPreset: string;
    name?: string;
  }): Promise<{ agentPreset: string }>;
  openDocument(
    agentPreset: string,
  ): Promise<{ opened: true } | { opened: false; path: string }>;
  remove(agentPreset: string): Promise<void>;
}

export interface AgentSettingsNamespace {
  ns: string;
  schema: unknown;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies: "live" | "restart";
  secrets: Array<{ path: string[]; set: boolean }>;
  revision: number;
}

export interface AgentSettingsAdapter {
  describe(): Promise<{
    writable: boolean;
    hasDocument: boolean;
    namespaces: AgentSettingsNamespace[];
  }>;
  update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<AgentSettingsNamespace>;
  replace(
    ns: string,
    section: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<AgentSettingsNamespace>;
  mutate(
    ns: string,
    ops: Array<
      | { op: "set"; path: string[]; value: unknown }
      | { op: "unset"; path: string[] }
    >,
    expectedRevision?: number,
  ): Promise<AgentSettingsNamespace>;
  openDocument(): Promise<{ opened: true }>;
}

export interface AgentCredentialView {
  configured: boolean;
  source?: string;
  writable: boolean;
}

export interface AgentCredentialsAdapter {
  describe(refs: string[]): Promise<Record<string, AgentCredentialView>>;
  set(ref: string, value: string): Promise<void>;
  unset(ref: string): Promise<void>;
}

export interface AgentPermissionOption {
  value: string;
  name: string;
  description?: string;
}

export interface AgentPermissionState {
  currentValue: string;
  options: AgentPermissionOption[];
  writable: boolean;
  revision?: number;
  scope: "default" | "session";
}

/** DSH permission presets for future-session defaults and pinned live sessions. */
export interface AgentPermissionsAdapter {
  getDefault(): Promise<AgentPermissionState>;
  setDefault(
    preset: string,
    expectedRevision?: number,
  ): Promise<AgentPermissionState>;
  getSession(sessionId: string): Promise<AgentPermissionState | null>;
  setSession(sessionId: string, preset: string): Promise<AgentPermissionState>;
}

/** Harness-independent model capability definition. */
export interface ModelDefinition {
  id: string;
  name: string;
  /** Product-level availability. Harness catalogs only receive enabled models. */
  enabled?: boolean;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  inputModalities?: string[];
  reasoning?: {
    efforts: Array<{
      id: string;
      name: string;
      description?: string;
      /** Optional provider-wire spelling; null means the parameter is omitted. */
      wireValue?: string | null;
    }>;
    defaultEffort?: string;
  };
}

/** Harness-independent provider grouping used by every AI-native consumer. */
export interface ModelGroup {
  id: string;
  name: string;
  models: ModelDefinition[];
}

/** @deprecated Use ModelGroup outside a harness execution adapter. */
export type AgentModelGroup = ModelGroup;

/** @deprecated Use ModelDefinition outside a harness execution adapter. */
export type AgentModelDefinition = ModelDefinition;

export interface AgentModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface AgentModelsAdapter {
  /** Runtime health and current binding for one materialized DSH session. */
  directory(sessionId: string): Promise<{
    current: AgentModelSelection;
    routable: boolean;
    groups: AgentModelGroup[];
    failures: Array<{ id: string; name: string; message: string }>;
  } | null>;
  select(
    sessionId: string,
    selection: AgentModelSelection,
  ): Promise<{
    selected: AgentModelSelection;
  }>;
}

export interface AgentSkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  source: string;
  provider: string;
  resourceBase?: AgentSkillResourceBase;
  editable: boolean;
}

export type AgentSkillResourceBase =
  | { kind: "directory"; path: string }
  | { kind: "url"; url: string }
  | { kind: "opaque"; description: string };

export interface AgentSkillDocument {
  name: string;
  document: string;
  editable: boolean;
  source: string;
  provider: string;
  resourceBase?: AgentSkillResourceBase;
}

export interface AgentSkillFileEntry {
  path: string;
  size: number;
}

export interface AgentSkillFileList {
  root: string;
  files: AgentSkillFileEntry[];
  truncated: boolean;
}

export interface AgentSkillFileContent {
  path: string;
  size: number;
  encoding: "utf-8" | "binary" | "too-large";
  content?: string;
}

/**
 * One row of the DSH-engine-native, session-scoped skill catalog (the
 * `skill.list` RPC — `@deepseek-ai/dsh-host-apiproxy`'s `SkillEntry`).
 * `userInvocable` is always `true`: the engine RPC's own contract documents
 * it as "the user-invocable skill catalog for the session's project", so
 * every row it returns already satisfies that filter by construction — this
 * is a documented invariant, not a guess. `source`/`provider`/
 * `resourceBase`/`editable` (see `AgentSkillEntry` above) are NOT part of
 * the engine wire contract ("provider/source vocabulary stays host-side"
 * per its own doc-comment) and have no equivalent here.
 */
export interface AgentSkillMention {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: true;
}

/**
 * The chat composer's `/`-skill mention surface only, backed by the
 * DSH-engine-native `skill.list` RPC (`DshApiClient.listSkills`) — never a
 * plugin Remote. The full skills-authoring CRUD surface (browse / read /
 * edit / save / remove against `AgentSkillEntry`/`AgentSkillDocument`/
 * `AgentSkillFileList`/`AgentSkillFileContent` above) moved out of the
 * platform contract entirely: `dsh-plugin-skills` now builds its own local
 * adapter directly from its own Remote face for that surface, decoupled
 * from `PlatformAdapter`.
 */
export interface AgentSkillsAdapter {
  list(sessionId: string): Promise<{ skills: AgentSkillMention[] }>;
}

export interface AgentCommandEntry {
  name: string;
  description: string;
  inputHint?: string;
}

/** Session-scoped human commands registered by the active DSH composition. */
export interface AgentCommandsAdapter {
  list(sessionId: string): Promise<AgentCommandEntry[]>;
}

export type ModelProviderProtocol =
  | "deepseek-chat-completions"
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "provider-native";

/** Canonical provider configuration owned by Amiba, independent of a harness. */
export interface ModelProviderProfile {
  id: string;
  displayName: string;
  protocol: ModelProviderProtocol;
  baseURL?: string;
  credentialRef?: string;
  enabled: boolean;
  editable: boolean;
  source: "builtin" | "user" | "imported";
  models: ModelDefinition[];
}

export interface ModelPlaneSnapshot {
  revision: number;
  providers: ModelProviderProfile[];
  groups: ModelGroup[];
  /** Product default used before an execution session is materialized. */
  defaultSelection?: AgentModelSelection;
  credentials: Record<string, AgentCredentialView>;
  failures: Array<{ id: string; name: string; message: string }>;
}

/**
 * Product-level model plane. DSH is one execution projection of this state;
 * other AI-native consumers use the same provider/model definitions directly.
 */
export interface ModelPlaneAdapter {
  snapshot(): Promise<ModelPlaneSnapshot>;
  setDefaultSelection(
    selection: AgentModelSelection,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  upsert(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
    expectedRevision?: number;
  }): Promise<ModelPlaneSnapshot>;
  remove(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  discover(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
  }): Promise<{ models: ModelDefinition[] }>;
  unsetCredential(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
}

export interface AgentUsageRecord {
  ts: number;
  sessionId: string;
  turn: number;
  step: number;
  provider: string;
  model: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/** Provider-reported DSH usage, deduplicated at the canonical turn/step seam. */
export interface AgentUsageAdapter {
  list(): Promise<{
    records: AgentUsageRecord[];
    failures: Array<{ sessionId: string; message: string }>;
  }>;
}

export type AgentRuntimeLogLevel = "debug" | "info" | "warning" | "error";

export interface AgentRuntimeLogEntry {
  seq: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  level: AgentRuntimeLogLevel;
  message: string;
}

export interface AgentRuntimeStatus {
  runtime: "dsh";
  healthy: boolean;
  state: "stopped" | "starting" | "running" | "failed";
  version: string;
  commit: string;
  nodeVersion: string;
  pid?: number;
  startedAt?: number;
  sessionCount: number;
  liveSessionCount: number;
  paths: {
    home: string;
    agentsHome: string;
    runtimeDir: string;
  };
  error?: string;
}

/** Health and bounded in-memory logs for the immutable managed DSH process. */
export interface AgentDiagnosticsAdapter {
  status(): Promise<AgentRuntimeStatus>;
  restart(): Promise<AgentRuntimeStatus>;
  logs(input?: {
    limit?: number;
    level?: AgentRuntimeLogLevel | "all";
    stream?: AgentRuntimeLogEntry["stream"] | "all";
    search?: string;
  }): Promise<{ entries: AgentRuntimeLogEntry[] }>;
}

export interface ShellAdapter {
  openExternal(url: string): Promise<void>;
}

export type EmbeddedBrowserCommand =
  | { action: "navigate"; url: string }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" }
  | { action: "stop" };

export interface EmbeddedBrowserPageState {
  tab_id: string;
  url: string;
  title: string;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
}

/**
 * Desktop-owned bridge for the visible browser workbench.
 *
 * The renderer owns browser chrome and tabs; Electron main owns privileged
 * WebContents lookup and is also the endpoint used by DSH browser tools. A tab
 * is registered only after its isolated `<webview>` has attached.
 */
export interface EmbeddedBrowserAdapter {
  registerTab(input: {
    tabId: string;
    webContentsId: number;
    active?: boolean;
  }): Promise<EmbeddedBrowserPageState>;
  unregisterTab(tabId: string): Promise<void>;
  setActiveTab(tabId: string): Promise<EmbeddedBrowserPageState>;
  command(
    tabId: string,
    command: EmbeddedBrowserCommand,
  ): Promise<EmbeddedBrowserPageState>;
  detectDevServers(): Promise<Array<{ url: string; port: number }>>;
  onCreateRequested(listener: () => void): () => void;
  onFocusRequested(listener: (event: { tabId: string }) => void): () => void;
  onAgentActivity(
    listener: (event: {
      tabId: string;
      action: string;
      running: boolean;
    }) => void,
  ): () => void;
}

/**
 * A workspace change event. Always carries the `sessionId` the binding
 * belongs to so a single renderer subscriber can route events across
 * multiple chat surfaces. File-change events are NOT broadcast over this
 * channel — the watcher consumes them in main for fs-scoped tooling but
 * doesn't fan them out to renderers (they were a no-op at every
 * subscriber and easy to flood under noisy trees like `node_modules`).
 */
export type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string };

/**
 * Workspace binding — per chat session. Each session can pin a different
 * directory; desktop forwards that path as the structured cwd for every
 * DSH turn in the session.
 *
 * Desktop hosts expose this adapter; non-directory hosts leave it undefined.
 */
export interface WorkspaceAdapter {
  /**
   * Open the host's native folder picker. Omitted on runtimes that cannot
   * choose local directories (for example, a headless host process).
   */
  chooseDirectory?(defaultPath?: string): Promise<string | null>;
  /** Product-level root used when a session has no explicit binding. */
  getDefaultRoot(): Promise<string>;
  bind(sessionId: string, path: string): Promise<void>;
  unbind(sessionId: string): Promise<void>;
  getCurrent(sessionId: string): Promise<string | null>;
  /** Snapshot every persisted session binding for workspace-grouped history. */
  listBindings(): Promise<Record<string, string>>;
  onChange(cb: (change: WorkspaceChange) => void): () => void;
}

export interface WorkspaceFileDocument {
  /** Canonical absolute path after main-process workspace validation. */
  path: string;
  /** Slash-normalised path relative to the bound workspace root. */
  relativePath: string;
  name: string;
  content: string;
  size: number;
  modifiedAt: number;
  revision: string;
  truncated: boolean;
  binary: boolean;
}

export interface WorkspaceFileChange {
  subscriptionId: string;
  sessionId: string;
  path: string;
  event: "add" | "change" | "unlink";
}

export interface WorkspaceTreeEntry {
  name: string;
  /** Slash-normalised path relative to the active workspace root. */
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface WorkspaceGitFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface WorkspaceGitState {
  root: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  files: WorkspaceGitFile[];
}

export interface WorkspaceCheckpoint {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  changedFiles: number;
  kind?: "turn-start" | "restore-safety" | "manual";
  /** Zero-based user-turn index used to place recovery beside the task. */
  turnIndex?: number;
  /** Set after the Agent executes a tool that may mutate the workspace. */
  hasChanges?: boolean;
  /** False when one or more untracked files exceeded the safety limits. */
  complete?: boolean;
}

export interface WorkspaceCheckpointOptions {
  kind?: WorkspaceCheckpoint["kind"];
  turnIndex?: number;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  folders: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceWorktree {
  path: string;
  head: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  locked?: string;
}

export interface WorkspaceTerminalSnapshot {
  sessionId: string;
  terminalId: string;
  title: string;
  cwd: string;
  output: string;
  /** Monotonic PTY output sequence used to resume without duplicating bytes. */
  sequence: number;
  running: boolean;
  startedAt: number;
  exitCode?: number;
}

/**
 * Read-only workspace resource bridge used by the desktop workbench.
 *
 * File access remains in Electron main. Renderers submit a session id and a
 * path hint; main resolves it against that session's bound workspace and
 * rejects traversal / symlink escapes before touching the file.
 */
export interface WorkspaceFilesAdapter {
  list(sessionId: string, path?: string): Promise<WorkspaceTreeEntry[]>;
  search(sessionId: string, query: string): Promise<WorkspaceTreeEntry[]>;
  read(sessionId: string, path: string): Promise<WorkspaceFileDocument>;
  reveal(sessionId: string, path: string): Promise<void>;
  openExternal(sessionId: string, path: string): Promise<void>;
  watch(
    sessionId: string,
    paths: string[],
    listener: (change: WorkspaceFileChange) => void,
  ): () => void;
}

export interface WorkspaceDevelopmentAdapter {
  ensureProject(sessionId: string): Promise<WorkspaceProject>;
  listProjects(): Promise<WorkspaceProject[]>;
  createProject(name: string, folders: string[]): Promise<WorkspaceProject>;
  addProjectFolder(
    projectId: string,
    folder: string,
  ): Promise<WorkspaceProject>;
  bindProjectLocation(
    sessionId: string,
    projectId: string,
    path: string,
  ): Promise<WorkspaceProject>;
  listWorktrees(sessionId: string): Promise<WorkspaceWorktree[]>;
  createWorktree(
    sessionId: string,
    branch: string,
    baseRef?: string,
  ): Promise<WorkspaceWorktree>;
  gitStatus(sessionId: string): Promise<WorkspaceGitState>;
  gitDiff(
    sessionId: string,
    options?: { staged?: boolean; paths?: string[] },
  ): Promise<string>;
  gitStage(sessionId: string, paths?: string[]): Promise<WorkspaceGitState>;
  gitUnstage(sessionId: string, paths?: string[]): Promise<WorkspaceGitState>;
  gitCommit(sessionId: string, message: string): Promise<WorkspaceGitState>;
  gitShip(sessionId: string, remote?: string): Promise<WorkspaceGitState>;
  listCheckpoints(sessionId: string): Promise<WorkspaceCheckpoint[]>;
  /** Resolves null when the session's workspace is not a Git repository —
   *  auto-checkpoint callers should treat that as "unavailable", not an error. */
  createCheckpoint(
    sessionId: string,
    label: string,
    options?: WorkspaceCheckpointOptions,
  ): Promise<WorkspaceCheckpoint | null>;
  markCheckpointChanged(
    sessionId: string,
    checkpointId: string,
  ): Promise<WorkspaceCheckpoint>;
  restoreCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<WorkspaceGitState>;
  deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void>;
  terminalStart(
    sessionId: string,
    terminalId: string,
  ): Promise<WorkspaceTerminalSnapshot>;
  terminalList(sessionId: string): Promise<WorkspaceTerminalSnapshot[]>;
  terminalGet(
    sessionId: string,
    terminalId: string,
  ): Promise<WorkspaceTerminalSnapshot | null>;
  terminalWrite(sessionId: string, terminalId: string, input: string): void;
  terminalResize(
    sessionId: string,
    terminalId: string,
    columns: number,
    rows: number,
  ): void;
  terminalStop(sessionId: string, terminalId: string): Promise<void>;
  onTerminalData(
    listener: (event: {
      sessionId: string;
      terminalId: string;
      chunk: string;
      sequence: number;
      snapshot: WorkspaceTerminalSnapshot;
    }) => void,
  ): () => void;
}

export interface PlatformAdapter {
  kind: "desktop" | "web";
  /**
   * Host-owned window chrome geometry. Product UI uses this to keep its
   * controls clear of native title-bar affordances such as macOS traffic
   * lights without guessing the operating system from browser user-agent
   * fields.
   */
  windowChrome?: {
    topBarHeightPx: number;
    leftInsetPx: number;
  };
  storage: StorageAdapter;
  shell: ShellAdapter;
  /** Canonical runtime-owned sessions. Present on DSH-native surfaces. */
  agentSessions?: AgentSessionsAdapter;
  /** Opaque attachment storage contributed by the Amiba DSH plugin. */
  agentAttachments?: AgentAttachmentsAdapter;
  /** Canonical DSH workspace registry. */
  agentWorkspaces?: AgentWorkspacesAdapter;
  /** DSH agent preset roster/authoring. */
  agentPresets?: AgentPresetsAdapter;
  agentSettings?: AgentSettingsAdapter;
  agentCredentials?: AgentCredentialsAdapter;
  agentPermissions?: AgentPermissionsAdapter;
  /** Harness-independent provider/model source of truth. */
  modelPlane?: ModelPlaneAdapter;
  /** Session-scoped DSH execution projection and selection. */
  agentModels?: AgentModelsAdapter;
  agentSkills?: AgentSkillsAdapter;
  agentCommands?: AgentCommandsAdapter;
  agentUsage?: AgentUsageAdapter;
  agentDiagnostics?: AgentDiagnosticsAdapter;
  /** Desktop-only visible browser and Agent-control bridge. */
  embeddedBrowser?: EmbeddedBrowserAdapter;
  /** Desktop-only workspace bridge. */
  workspaces?: WorkspaceAdapter;
  /** Desktop-only, read-only file surface for the workspace workbench. */
  workspaceFiles?: WorkspaceFilesAdapter;
  /** Desktop-only Project/Worktree/terminal/Git/checkpoint control surface. */
  workspaceDevelopment?: WorkspaceDevelopmentAdapter;
}

// Client plugins are independently bundled by DSH, so this module can exist
// more than once in the same renderer. Keep the adapter on the realm-wide
// symbol registry instead of module scope; every bundled copy then observes
// the Electron adapter installed before the DSH Web Shell boots.
const PLATFORM_ADAPTER_KEY = Symbol.for("@amiba/app-runtime/platform-adapter");

function readPlatform(): PlatformAdapter | null {
  const registry = globalThis as unknown as Record<PropertyKey, unknown>;
  return (
    (registry[PLATFORM_ADAPTER_KEY] as PlatformAdapter | undefined) ?? null
  );
}

export function setPlatform(adapter: PlatformAdapter) {
  const registry = globalThis as unknown as Record<PropertyKey, unknown>;
  registry[PLATFORM_ADAPTER_KEY] = adapter;
}

export function getPlatform(): PlatformAdapter {
  const current = readPlatform();
  if (!current)
    throw new Error(
      "PlatformAdapter not initialized — call setPlatform() at boot",
    );
  return current;
}

export function hasPlatform(): boolean {
  return readPlatform() !== null;
}
