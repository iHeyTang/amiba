import type { AgentSubagentAddress } from "../platform/index.js"

export { upsertCompactionTimeline, interruptOpenCompactions } from "./compaction.js"
export interface DshRpcErrorShape {
  code: string
  message: string
  details?: unknown
}

export { DshChatEngineClient, type DshChatEngineOptions } from "./chat-engine.js"
export { createWebPlatformAdapter } from "./web-platform.js"

export {
  createDshPlatformAdapters,
  type DshPlatformAdapters,
} from "./platform-adapters.js"

export class DshRpcError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(error: DshRpcErrorShape) {
    super(error.message)
    this.name = "DshRpcError"
    this.code = error.code
    this.details = error.details
  }
}

export interface DshSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: string
}

export type DshMuxFrame =
  | { type: "session/event"; sessionId: string; event: DshSessionEvent; view?: unknown }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number }
  | { type: "approval/requested"; sessionId: string; approvalId: string; toolName: string; callId?: string; reason?: string }
  | { type: "approval/resolved"; sessionId: string; approvalId: string; outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable" }
  | { type: "question/requested"; sessionId: string; questions: DshQuestionItem[] }
  | { type: "question/resolved"; sessionId: string; questionRpcId: string; outcome: "answered" | "cancelled" }
  | { type: "session/queue"; sessionId: string; items: unknown[] }
  | { type: "session/jobs"; sessionId: string; jobs: unknown[] }
  | { type: "session/projection"; sessionId: string; key: string; value: unknown; seq: number }
  | { type: "stream/error"; error: DshRpcErrorShape }

export interface DshQuestionItem {
  id: string
  question: string
  header?: string
  detail?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
  /** Presentation intent; DSH ships "plan-review" (approve names an option label). */
  intent?: { kind: string; approve: string }
}

export interface DshMuxEnvelope {
  rpcId: string
  payload: DshMuxFrame
}

export interface DshHistoryEntry {
  event: DshSessionEvent
  view?: unknown
}

export interface DshHistoryPage {
  events: DshHistoryEntry[]
  hasMore: boolean
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

export interface DshSessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: "subagent"
  cwd?: string
  agentPreset?: string
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

export interface DshWorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface DshAgentPresetEntry {
  id: string
  trust: "system" | "user"
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

export interface DshSkillEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface DshSettingsNamespace {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: "live" | "restart"
  secrets: Array<{ path: string[]; set: boolean }>
  revision: number
}

export interface DshConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  active: boolean
  declared?: boolean
}

export interface DshModelGroup {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    description?: string
    reasoning?: {
      efforts: Array<{ id: string; name: string; description?: string }>
      defaultEffort?: string
    }
  }>
}

export interface DshDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export type DshImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"

export type DshPromptContentPart =
  | { type: "text"; text: string }
  | {
      type: "image"
      mediaType: DshImageMediaType
      data: string
      name?: string
    }

export interface DshClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  makeRpcId?: () => string
  createWebSocket?: (url: string) => DshWebSocketLike
}

export interface DshWebSocketLike {
  readonly readyState: number
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  close(code?: number, reason?: string): void
}

interface DshResponseEnvelope<T> {
  type: "server-response"
  rpcId: string
  result:
    | { ok: true; value: T }
    | { ok: false; error: DshRpcErrorShape }
}

function rpcMethodPath(method: string): string {
  return method
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

export class DshApiClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly makeRpcId: () => string
  private readonly createWebSocket: (url: string) => DshWebSocketLike

  constructor(options: DshClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "")
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.makeRpcId = options.makeRpcId ?? (() => crypto.randomUUID())
    this.createWebSocket = options.createWebSocket ?? ((url) => {
      const WebSocketConstructor = globalThis.WebSocket
      if (typeof WebSocketConstructor !== "function") {
        throw new Error("DSH events.mux requires a WebSocket implementation")
      }
      return new WebSocketConstructor(url) as DshWebSocketLike
    })
  }

  async call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const rpcId = this.makeRpcId()
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/${rpcMethodPath(method)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId,
          method,
          payload,
        }),
        signal,
      },
    )
    if (!response.ok) {
      throw new Error(`DSH ${method} failed over HTTP ${response.status}: ${await response.text()}`)
    }
    const envelope = (await response.json()) as DshResponseEnvelope<T>
    if (envelope.type !== "server-response" || envelope.rpcId !== rpcId) {
      throw new Error(`DSH ${method} returned an invalid RPC envelope`)
    }
    if (!envelope.result.ok) throw new DshRpcError(envelope.result.error)
    return envelope.result.value
  }

  createSession(
    payload: { sessionId?: string; cwd?: string; workspaceId?: string; agentPreset?: string } = {},
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.call("session.create", payload, signal)
  }

  listSessions(signal?: AbortSignal): Promise<{ items: DshSessionSummary[] }> {
    return this.call("session.list", {}, signal)
  }

  searchSessions(
    query: string,
    signal?: AbortSignal,
  ): Promise<{
    items: Array<{ sessionId: string; snippet: string }>
    hasMore: boolean
  }> {
    return this.call("session.search", { query }, signal)
  }

  renameSession(
    sessionId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; seq: number }> {
    return this.call("session.rename", { sessionId, title }, signal)
  }

  forkSession(
    sessionId: string,
    atSeq?: number,
    signal?: AbortSignal,
  ): Promise<{ sessionId: string }> {
    return this.call(
      "session.fork",
      { sessionId, ...(atSeq === undefined ? {} : { atSeq }) },
      signal,
    )
  }

  listSkills(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ skills: DshSkillEntry[] }> {
    return this.call("skill.list", { sessionId }, signal)
  }

  listWorkspaces(signal?: AbortSignal): Promise<{
    items: DshWorkspaceView[]
    archivedSessionIds: string[]
  }> {
    return this.call("workspace.list", {}, signal)
  }

  createWorkspace(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView; created: boolean }> {
    return this.call("workspace.create", { path }, signal)
  }

  renameWorkspace(
    workspaceId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView }> {
    return this.call("workspace.rename", { workspaceId, title }, signal)
  }

  async deleteWorkspace(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call("workspace.delete", { workspaceId }, signal)
  }

  reorderWorkspace(
    workspaceId: string,
    beforeWorkspaceId?: string,
    signal?: AbortSignal,
  ): Promise<{ workspaceIds: string[] }> {
    return this.call(
      "workspace.insertBefore",
      {
        workspaceId,
        ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
      },
      signal,
    )
  }

  reorderWorkspaceSession(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView }> {
    return this.call(
      "workspace.insertSessionBefore",
      {
        workspaceId,
        sessionId,
        ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
      },
      signal,
    )
  }

  archiveSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ archivedSessionIds: string[] }> {
    return this.call("workspace.archiveSession", { sessionId }, signal)
  }

  listAgentPresets(signal?: AbortSignal): Promise<{
    presets: DshAgentPresetEntry[]
    authorable: boolean
    hasDocument: boolean
  }> {
    return this.call("agentPreset.list", {}, signal)
  }

  selectAgentPreset(
    sessionId: string,
    agentPreset: string,
    signal?: AbortSignal,
  ): Promise<{ agentPreset: string }> {
    return this.call("agentPreset.select", { sessionId, agentPreset }, signal)
  }

  readAgentPreset(agentPreset: string, signal?: AbortSignal): Promise<{
    agentPreset: string
    trust: "system" | "user"
    content: string
    name?: string
    description?: string
  }> {
    return this.call("agentPreset.read", { agentPreset }, signal)
  }

  copyAgentPreset(
    input: { from: string; agentPreset: string; name?: string },
    signal?: AbortSignal,
  ): Promise<{ agentPreset: string }> {
    return this.call("agentPreset.copy", input, signal)
  }

  openAgentPreset(
    agentPreset: string,
    signal?: AbortSignal,
  ): Promise<{ opened: true } | { opened: false; path: string }> {
    return this.call("agentPreset.openDocument", { agentPreset }, signal)
  }

  async removeAgentPreset(agentPreset: string, signal?: AbortSignal): Promise<void> {
    await this.call("agentPreset.remove", { agentPreset }, signal)
  }

  describeSettings(signal?: AbortSignal): Promise<{
    writable: boolean
    hasDocument: boolean
    namespaces: DshSettingsNamespace[]
  }> {
    return this.call("settings.describe", {}, signal)
  }

  updateSettings(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<DshSettingsNamespace> {
    return this.call(
      "settings.update",
      { ns, patch, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
      signal,
    )
  }

  replaceSettings(
    ns: string,
    section: Record<string, unknown>,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<DshSettingsNamespace> {
    return this.call(
      "settings.replace",
      { ns, section, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
      signal,
    )
  }

  mutateSettings(
    ns: string,
    ops: Array<
      | { op: "set"; path: string[]; value: unknown }
      | { op: "unset"; path: string[] }
    >,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<DshSettingsNamespace> {
    return this.call(
      "settings.mutate",
      { ns, ops, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
      signal,
    )
  }

  openSettings(signal?: AbortSignal): Promise<{ opened: true }> {
    return this.call("settings.openDocument", {}, signal)
  }

  async describeCredentials(
    refs: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, { configured: boolean; source?: string; writable: boolean }>> {
    const result = await this.call<{
      credentials: Record<
        string,
        { configured: boolean; source?: string; writable: boolean }
      >
    }>("credentials.describe", { refs }, signal)
    return result.credentials
  }

  async setCredential(ref: string, value: string, signal?: AbortSignal): Promise<void> {
    await this.call("credentials.set", { ref, value }, signal)
  }

  async unsetCredential(ref: string, signal?: AbortSignal): Promise<void> {
    await this.call("credentials.unset", { ref }, signal)
  }

  listModelProviders(signal?: AbortSignal): Promise<{
    providers: DshConfigurableProvider[]
  }> {
    return this.call("llm.providers", {}, signal)
  }

  listModels(signal?: AbortSignal): Promise<{
    groups: DshModelGroup[]
    failures: Array<{ id: string; name: string; message: string }>
  }> {
    return this.call("llm.models", {}, signal)
  }

  discoverModels(
    input: {
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    },
    signal?: AbortSignal,
  ): Promise<{ models: DshDiscoveredModel[] }> {
    return this.call("llm.discoverModels", input, signal)
  }

  prompt(
    sessionId: string,
    content: string | DshPromptContentPart[],
    options: { mode?: "queue" | "steer"; clientTimeZone?: string; signal?: AbortSignal } = {},
  ): Promise<{
    accepted: true
    command?: { kind: "success" | "error"; text?: string }
  }> {
    return this.call(
      "session.prompt",
      {
        sessionId,
        mode: options.mode ?? "queue",
        content:
          typeof content === "string"
            ? [{ type: "text", text: content }]
            : content,
        ...(options.clientTimeZone
          ? { clientTimeZone: options.clientTimeZone }
          : {}),
      },
      options.signal,
    )
  }

  history(
    sessionId: string,
    options: { beforeSeq?: number; maxMessages?: number; signal?: AbortSignal } = {},
  ): Promise<DshHistoryPage> {
    return this.call(
      "session.history",
      {
        sessionId,
        ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
        ...(options.maxMessages === undefined ? {} : { maxMessages: options.maxMessages }),
      },
      options.signal,
    )
  }

  /** Read a catalog child without resuming either it or its direct parent. */
  subagentHistory(
    address: AgentSubagentAddress,
    options: { beforeSeq?: number; maxMessages?: number; signal?: AbortSignal } = {},
  ): Promise<DshHistoryPage> {
    return this.call(
      "subagent.history",
      {
        parentSessionId: address.parentSessionId,
        childSessionId: address.childSessionId,
        mode: address.mode,
        ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
        ...(options.maxMessages === undefined ? {} : { maxMessages: options.maxMessages }),
      },
      options.signal,
    )
  }

  subagentPrompt(
    address: AgentSubagentAddress & { mode: "continuable" },
    content: DshPromptContentPart[],
    options: { clientTimeZone?: string; signal?: AbortSignal } = {},
  ): Promise<{ messageId: string }> {
    if (address.mode !== "continuable") return Promise.reject(new Error("One-shot subagents cannot receive follow-up prompts"))
    if (content.some((part) => part.type === "image")) return Promise.reject(new Error("Image input is unavailable for subagent continuations"))
    return this.call("subagent.prompt", {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      mode: address.mode,
      content,
      ...(options.clientTimeZone ? { clientTimeZone: options.clientTimeZone } : {}),
    }, options.signal)
  }

  subagentInterrupt(
    address: AgentSubagentAddress & { mode: "continuable" },
  ): Promise<{ accepted: true }> {
    if (address.mode !== "continuable") return Promise.reject(new Error("One-shot subagents do not support continuation interrupts"))
    return this.call("subagent.interrupt", {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      mode: address.mode,
    })
  }

  models(sessionId: string, signal?: AbortSignal): Promise<{
    current: { provider: string; model: string; reasoningEffort?: string }
    routable: boolean
    groups: unknown[]
    failures: unknown[]
  }> {
    return this.call("session.models", { sessionId }, signal)
  }

  selectModel(
    payload: {
      sessionId: string
      provider: string
      model: string
      reasoningEffort?: string
    },
    signal?: AbortSignal,
  ): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
    return this.call("session.selectModel", payload, signal)
  }

  cancel(sessionId: string, signal?: AbortSignal): Promise<{ accepted: true }> {
    return this.call("session.cancel", { sessionId }, signal)
  }

  async respond(
    requestId: string,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respondWith(requestId, { ok: true, value }, signal)
  }

  private async respondWith(
    requestId: string,
    result:
      | { ok: true; value: unknown }
      | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-response",
        rpcId: requestId,
        result,
      }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`DSH respond failed over HTTP ${response.status}: ${await response.text()}`)
    }
    return (await response.json()) as { accepted: boolean; reason?: string }
  }

  respondApproval(
    requestId: string,
    payload: { sessionId: string; approvalId: string; outcome: "allowed-once" | "rejected" },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respond(requestId, payload, signal)
  }

  respondToQuestions(
    requestId: string,
    payload: { sessionId: string; answer: unknown },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respond(requestId, payload, signal)
  }

  /** Reject a question wait outright — DSH resolves the ask tool call as cancelled. */
  cancelQuestions(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respondWith(
      requestId,
      {
        ok: false,
        error: {
          code: "cancelled",
          message: "the user closed this question request",
          details: {},
        },
      },
      signal,
    )
  }

  /** Resolves after the Host establishes its mux, even with no attached sessions. */
  async openEvents(signal?: AbortSignal): Promise<AsyncIterableIterator<DshMuxEnvelope>> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/events.mux`, { signal })
    if (!response.ok || !response.body) throw new Error(`DSH events.mux failed: HTTP ${response.status}`)
    const reader = response.body.getReader()
    let closing: Promise<void> | undefined
    const close = () => closing ??= reader.cancel().catch(() => {}).finally(() => reader.releaseLock())
    const frames = (async function* () {
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buffer += decoder.decode(value, { stream: true })
          let boundary: number
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("")
            if (!data) continue
            const frame = parseDshWebSocketFrame(data)
            if (frame.payload.type === "stream/error") throw new DshRpcError(frame.payload.error)
            yield frame
          }
        }
      } finally {
        await close()
      }
    })()
    const stream: AsyncIterableIterator<DshMuxEnvelope> = {
      next: () => frames.next(),
      return: async () => { await close(); return frames.return(undefined) },
      [Symbol.asyncIterator]: () => stream,
    }
    return stream
  }

  async *events(signal?: AbortSignal): AsyncGenerator<DshMuxEnvelope> {
    if (signal?.aborted) return

    const url = new URL("/api/events.mux", `${this.baseUrl}/`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = this.createWebSocket(url.href)
    type Queued =
      | { kind: "frame"; value: DshMuxEnvelope }
      | { kind: "error"; error: Error }
      | { kind: "aborted" }
    const queued: Queued[] = []
    let resume: ((item: Queued) => void) | undefined
    let abortHandled = false

    const enqueue = (item: Queued): void => {
      const current = resume
      if (current) {
        resume = undefined
        current(item)
      } else {
        queued.push(item)
      }
    }
    const next = (): Promise<Queued> => {
      const item = queued.shift()
      if (item) return Promise.resolve(item)
      return new Promise((resolve) => {
        resume = resolve
      })
    }
    const onMessage = (event: Event): void => {
      try {
        const data = (event as MessageEvent<unknown>).data
        if (typeof data !== "string") {
          throw new Error("DSH events.mux returned a non-text WebSocket frame")
        }
        enqueue({ kind: "frame", value: parseDshWebSocketFrame(data) })
      } catch (error) {
        enqueue({
          kind: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
    const onError = (): void => {
      enqueue({ kind: "error", error: new Error("DSH events.mux WebSocket failed") })
    }
    const onClose = (event: Event): void => {
      if (signal?.aborted) {
        enqueue({ kind: "aborted" })
        return
      }
      const close = event as CloseEvent
      const suffix = close.reason ? `: ${close.reason}` : ""
      enqueue({
        kind: "error",
        error: new Error(`DSH events.mux WebSocket closed (${close.code})${suffix}`),
      })
    }
    const onAbort = (): void => {
      if (abortHandled) return
      abortHandled = true
      if (socket.readyState < 2) socket.close(1000, "aborted")
      enqueue({ kind: "aborted" })
    }

    socket.addEventListener("message", onMessage)
    socket.addEventListener("error", onError)
    socket.addEventListener("close", onClose)
    signal?.addEventListener("abort", onAbort, { once: true })
    // Abort can race the listener registration above. Re-check after the
    // listener is attached so cancellation cannot leave next() waiting
    // forever; onAbort is idempotent when the event already fired.
    if (signal?.aborted) onAbort()

    try {
      for (;;) {
        const item = await next()
        if (item.kind === "aborted") return
        if (item.kind === "error") throw item.error
        if (item.value.payload.type === "stream/error") {
          throw new DshRpcError(item.value.payload.error)
        }
        yield item.value
      }
    } finally {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("error", onError)
      socket.removeEventListener("close", onClose)
      signal?.removeEventListener("abort", onAbort)
      if (socket.readyState < 2) socket.close(1000, "iterator closed")
    }
  }
}

export function parseDshWebSocketFrame(data: string): DshMuxEnvelope {
  const parsed = JSON.parse(data) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DSH events.mux returned an invalid server-request envelope")
  }
  const envelope = parsed as Record<string, unknown>
  const payload = envelope.payload
  if (
    envelope.type !== "server-request" ||
    typeof envelope.rpcId !== "string" ||
    typeof envelope.method !== "string" ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).type !== "string"
  ) {
    throw new Error("DSH events.mux returned an invalid server-request envelope")
  }
  const frame = payload as Record<string, unknown>
  if (frame.type === "stream/error") {
    const error = frame.error
    if (
      !error ||
      typeof error !== "object" ||
      Array.isArray(error) ||
      typeof (error as Record<string, unknown>).code !== "string" ||
      typeof (error as Record<string, unknown>).message !== "string"
    ) {
      throw new Error("DSH events.mux returned an invalid stream error")
    }
  }
  return { rpcId: envelope.rpcId, payload: payload as DshMuxFrame }
}

export * from "./amiba-event-bridge"

export * from "./assistant-text-source";
