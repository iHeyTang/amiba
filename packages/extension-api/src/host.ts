import type { SettingsSchema } from "./settings"

export interface Disposable {
  dispose(): void
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface IpcContext {
  /** Numeric id of the BrowserWindow that issued the call, or null for main. */
  windowId: number | null
}

/**
 * Per-turn token usage payload, OpenAI-style field names so it can be
 * threaded straight through from `/v1/chat/completions` without a
 * client-side rename pass. Numeric fields are always present (0 when
 * unknown) so subscribers don't have to nil-check every read.
 */
export interface ChatRunCompletedEvent {
  /** Hermes session id, when the run carried one. */
  sessionId?: string
  /** Model id the run was dispatched against (e.g. "claude-opus-4-7"). */
  model?: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Fired when hermes-agent reports that a tool call has started running
 * (SSE `hermes.tool.progress` event with `status: "running"`).
 * Subscribers commonly use this to log "agent just invoked X" without
 * having to wait for completion.
 */
export interface ChatToolStartedEvent {
  sessionId?: string
  runId?: string
  /** Tool name, e.g. "search", "shell", "write_file". */
  tool: string
  /** Provider-side correlation id linking this start to its completion. */
  toolCallId: string
  /** ms epoch when the gateway saw the tool start, when available. */
  startedAt?: number
  /** Optional human-readable label / emoji the gateway sometimes ships. */
  label?: string
  emoji?: string
}

/**
 * Fired when a tool call resolves (`hermes.tool.progress` with
 * `status: "completed"`). Same correlation id as the matching
 * `tool.started`; `durationMs` is the gateway-reported wall-clock
 * runtime when present, else undefined.
 */
export interface ChatToolCompletedEvent {
  sessionId?: string
  runId?: string
  tool: string
  toolCallId: string
  startedAt?: number
  durationMs?: number
  label?: string
  emoji?: string
}

/**
 * Allow-list of event names extensions can subscribe to via
 * `host.chat.onEvent`. Each name has its own payload type below;
 * `host.chat.onEvent` is overloaded per-name so subscribers get the
 * right type without a manual cast.
 */
export type ChatEventName =
  | "run.completed"
  | "tool.started"
  | "tool.completed"

export interface MainHost {
  readonly id: string
  /**
   * Host runtime info — notably the extension-API level this desktop
   * implements. (The WebView surface exposes this directly as
   * `window.amiba.apiVersion` — a single scalar doesn't warrant a
   * sub-namespace there.)
   */
  readonly hostInfo: { readonly apiVersion: number }
  logger: Logger
  ipc: {
    expose<TArgs = unknown, TRet = unknown>(
      channel: string,
      handler: (args: TArgs, ctx: IpcContext) => Promise<TRet> | TRet,
    ): Disposable
  }
  lifecycle: {
    onBootBackground(handler: () => Promise<void> | void): Disposable
    onShutdown(handler: () => Promise<void> | void): Disposable
  }
  settings: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  storage: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  hermes: {
    callTool<TArgs = unknown, TRet = unknown>(
      tool: string,
      args: TArgs,
    ): Promise<TRet>
    /**
     * Read-only accessor for a hermes-agent session's authoritative
     * stats — the same payload `GET /api/sessions/{id}` returns. Used
     * by usage / cost telemetry extensions that need ground-truth
     * numbers (hermes-agent computes cost against the actually-used
     * model, regardless of the routing placeholder the request
     * advertised).
     *
     * Returns null when:
     *   - the gateway is unreachable
     *   - the session id doesn't exist (404)
     *   - the payload didn't parse
     *
     * Callers should treat null as "no data" — don't synthesize a
     * zero-cost record from it.
     */
    getSession(sessionId: string): Promise<HermesSessionInfo | null>
    /**
     * Bulk read of hermes-agent's session list. Mirrors
     * `GET /api/sessions?limit=…&offset=…`. Returns the empty array
     * (NOT null) when the gateway is unreachable so callers can
     * unconditionally `.map` / `.filter` the result without nil-checks.
     *
     * The hermes-agent default page size is 50, max 200; pass `limit`
     * explicitly when you want all-time data (e.g. for the heatmap
     * window).
     */
    listSessions(opts?: {
      limit?: number
      offset?: number
      source?: string
    }): Promise<HermesSessionInfo[]>
  }
  /**
   * Subscribe to chat-engine events broadcast from the desktop main
   * process. Currently exposes "run.completed" only (final per-turn
   * usage) — the foundation hook for the token-meter / tool-call-
   * timeline / context-inspector class of extensions.
   *
   * Read-only: extensions observe what the agent did but cannot alter
   * the chat state from this surface. Handlers run in the extension's
   * utility process; throws are caught and logged by the runner.
   */
  chat: {
    onEvent(
      event: "run.completed",
      handler: (e: ChatRunCompletedEvent) => void,
    ): Disposable
    onEvent(
      event: "tool.started",
      handler: (e: ChatToolStartedEvent) => void,
    ): Disposable
    onEvent(
      event: "tool.completed",
      handler: (e: ChatToolCompletedEvent) => void,
    ): Disposable
  }
}

/**
 * Subset of hermes-agent's session row exposed to extensions. Field
 * names match the gateway's `_session_response` payload exactly so the
 * extension can pipe values through without renaming. `model` may be
 * the routing placeholder the client sent (e.g. "hermes-agent") — the
 * cost numbers were still computed against the real underlying model
 * inside the gateway, so trust them even when `model` looks generic.
 */
export interface HermesSessionInfo {
  id: string
  source?: string
  model?: string
  title?: string
  started_at?: number
  ended_at?: number
  end_reason?: string
  message_count?: number
  tool_call_count?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  estimated_cost_usd?: number
  actual_cost_usd?: number
  api_call_count?: number
  parent_session_id?: string
  last_active?: number
  has_system_prompt?: boolean
  has_model_config?: boolean
}

export type MainActivate = (host: MainHost) => Promise<void> | void
export type MainDeactivate = () => Promise<void> | void

export interface MainModule {
  activate: MainActivate
  deactivate?: MainDeactivate
}

export type { SettingsSchema }
