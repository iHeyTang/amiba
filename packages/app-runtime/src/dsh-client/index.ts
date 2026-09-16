export { bindOfficialAttachments } from "./official-attachments.js";
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
  | { type: "file"; receiptId: string }
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
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface DshResponseEnvelope<T> {
  type: "server-response"
  rpcId: string
  result:
    | { ok: true; value: T }
    | { ok: false; error: DshRpcErrorShape }
}

/**
 * DSH Remote endpoints are raw URL path segments (namespace/method). The
 * connection layer parses the undecoded pathname and only accepts segments
 * matching `[A-Za-z0-9_$.-]+` — in particular `$` (e.g. `$events/result`)
 * must stay literal. Percent-encoding here (`$` → `%24`) makes the server
 * reject the request with HTTP 404 "not found".
 */
const RPC_ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

function rpcMethodPath(method: string): string {
  const segments = method.split("/")
  if (segments.some((segment) => !RPC_ENDPOINT_SEGMENT.test(segment))) {
    throw new Error(`DSH RPC method ${JSON.stringify(method)} is not a valid endpoint path`)
  }
  return segments.join("/")
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

  private remote<T>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return this.call(endpoint, { args }, signal)
  }

  createSession(
    payload: { sessionId?: string; cwd?: string; workspaceId?: string; agentPreset?: string } = {},
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.remote("session/create", { request: payload }, signal)
  }

  listSessions(signal?: AbortSignal): Promise<{ items: DshSessionSummary[] }> {
    return this.remote("session/list", { _request: {} }, signal)
  }

  searchSessions(
    query: string,
    signal?: AbortSignal,
  ): Promise<{
    items: Array<{ sessionId: string; snippet: string }>
    hasMore: boolean
  }> {
    return this.remote("session/search", { request: { query } }, signal)
  }

  renameSession(
    sessionId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; seq: number }> {
    return this.remote("session/rename", { request: { sessionId, title } }, signal)
  }

  forkSession(
    sessionId: string,
    atSeq?: number,
    signal?: AbortSignal,
  ): Promise<{ sessionId: string }> {
    return this.remote(
      "session/fork",
      { request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) } },
      signal,
    )
  }

  listSkills(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ skills: DshSkillEntry[] }> {
    return this.remote("skills/list", { request: { sessionId } }, signal)
  }

  listWorkspaces(signal?: AbortSignal): Promise<{
    items: DshWorkspaceView[]
    archivedSessionIds: string[]
  }> {
    return this.firstStreamValue<{ type: "baseline"; value: { items: DshWorkspaceView[]; archivedSessionIds: string[] } }>("workspace/follow", {}, signal).then(frame => frame.value)
  }

  createWorkspace(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView; created: boolean }> {
    return this.remote("workspace/create", { request: { path } }, signal)
  }

  renameWorkspace(
    workspaceId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView }> {
    return this.remote("workspace/rename", { request: { workspaceId, title } }, signal)
  }

  async deleteWorkspace(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.remote("workspace/delete", { request: { workspaceId } }, signal)
  }

  reorderWorkspace(
    workspaceId: string,
    beforeWorkspaceId?: string,
    signal?: AbortSignal,
  ): Promise<{ workspaceIds: string[] }> {
    return this.remote(
      "workspace/insertBefore",
      { request: {
        workspaceId,
        ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
      } },
      signal,
    )
  }

  reorderWorkspaceSession(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
    signal?: AbortSignal,
  ): Promise<{ workspace: DshWorkspaceView }> {
    return this.remote(
      "workspace/insertSessionBefore",
      { request: {
        workspaceId,
        sessionId,
        ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
      } },
      signal,
    )
  }

  archiveSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ archivedSessionIds: string[] }> {
    return this.remote("workspace/archiveSession", { request: { sessionId } }, signal)
  }

  listAgentPresets(signal?: AbortSignal): Promise<{
    presets: DshAgentPresetEntry[]
    authorable: boolean
    hasDocument: boolean
  }> {
    return this.remote("agentPresets/list", {}, signal)
  }

  selectAgentPreset(
    sessionId: string,
    agentPreset: string,
    signal?: AbortSignal,
  ): Promise<{ agentPreset: string }> {
    return this.remote<string>("agentPresets/select", { agentId: sessionId, agentPreset }, signal).then(agentPreset => ({ agentPreset }))
  }

  readAgentPreset(agentPreset: string, signal?: AbortSignal): Promise<{
    agentPreset: string
    trust: "system" | "user"
    content: string
    name?: string
    description?: string
  }> {
    return this.remote("agentPresets/read", { agentPreset }, signal)
  }

  copyAgentPreset(
    input: { from: string; agentPreset: string; name?: string },
    signal?: AbortSignal,
  ): Promise<{ agentPreset: string }> {
    return this.remote<void>("agentPresets/copy", { from: input.from, id: input.agentPreset, name: input.name }, signal).then(() => ({ agentPreset: input.agentPreset }))
  }

  openAgentPreset(
    agentPreset: string,
    signal?: AbortSignal,
  ): Promise<{ opened: true } | { opened: false; path: string }> {
    return this.remote("settings/openAgentPresetDirectory", { agentPreset }, signal)
  }

  async removeAgentPreset(agentPreset: string, signal?: AbortSignal): Promise<void> {
    await this.remote("agentPresets/deletePreset", { id: agentPreset }, signal)
  }

  describeSettings(signal?: AbortSignal): Promise<{
    writable: boolean
    hasDocument: boolean
    namespaces: DshSettingsNamespace[]
  }> {
    return this.remote("settings/describe", {}, signal)
  }

  updateSettings(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<DshSettingsNamespace> {
    return this.remote(
      "settings/update",
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
    return this.remote(
      "settings/replace",
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
    return this.remote(
      "settings/mutate",
      { ns, ops, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
      signal,
    )
  }

  openSettings(signal?: AbortSignal): Promise<{ opened: true }> {
    return this.remote("settings/openSettingsDocument", {}, signal)
  }

  async describeCredentials(
    refs: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, { configured: boolean; source?: string; writable: boolean }>> {
    return this.remote("credentials/describe", { refs }, signal)
  }

  async setCredential(ref: string, value: string, signal?: AbortSignal): Promise<void> {
    await this.remote("credentials/set", { ref, value }, signal)
  }

  async unsetCredential(ref: string, signal?: AbortSignal): Promise<void> {
    await this.remote("credentials/unset", { ref }, signal)
  }

  listModelProviders(signal?: AbortSignal): Promise<{
    providers: DshConfigurableProvider[]
  }> {
    return Promise.all([
      this.remote<Omit<DshConfigurableProvider, "active">[]>("llm/listConfigurableProviders", {}, signal),
      this.remote<{ id: string }[]>("llm/listProviders", {}, signal),
    ]).then(([providers, active]) => ({ providers: providers.map(provider => ({ ...provider, active: active.some(item => item.id === provider.provider) })) }))
  }

  listModels(signal?: AbortSignal): Promise<{
    groups: DshModelGroup[]
    failures: Array<{ id: string; name: string; message: string }>
  }> {
    return this.remote("session/modelCatalog", {}, signal)
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
    const { settingsNs, ...request } = input
    return this.remote<DshDiscoveredModel[]>("llm/discoverModels", { settingsNs, request }, signal).then(models => ({ models }))
  }

  prompt(
    sessionId: string,
    content: string | DshPromptContentPart[],
    options: { mode?: "queue" | "steer"; clientTimeZone?: string; signal?: AbortSignal } = {},
  ): Promise<{
    accepted: true
    command?: { kind: "success" | "error"; text?: string }
  }> {
    return this.remote(
      "session/prompt",
      { request: {
        requestId: this.makeRpcId(),
        sessionId,
        mode: options.mode ?? "queue",
        content:
          typeof content === "string"
            ? [{ type: "text", text: content }]
            : content,
        ...(options.clientTimeZone
          ? { clientTimeZone: options.clientTimeZone }
          : {}),
      } },
      options.signal,
    )
  }

  private async readHistory(
    address: { kind: "session"; sessionId: string } | (AgentSubagentAddress & { kind: "subagent" }),
    options: { beforeSeq?: number; maxMessages?: number; signal?: AbortSignal },
  ): Promise<DshHistoryPage> {
    const source = this.stream<{
      type: string; cursor: number; records: DshHistoryEntry[]; hasMore: boolean;
      projections: DshHistoryPage["projections"];
    }>("session/follow", { request: { address, maxMessages: options.maxMessages } }, options.signal)
    try {
      const first = await source.next()
      if (first.done || first.value.type !== "snapshot") throw new Error("DSH session follow did not return an opening snapshot")
      const snapshot = first.value
      if (options.beforeSeq === undefined) return { events: snapshot.records, hasMore: snapshot.hasMore, projections: snapshot.projections }
      const page = await this.remote<{ records: DshHistoryEntry[]; hasMore: boolean }>("session/page", {
        request: { address, throughSeq: snapshot.cursor, beforeSeq: options.beforeSeq, maxMessages: options.maxMessages },
      }, options.signal)
      return { events: page.records, hasMore: page.hasMore, projections: snapshot.projections }
    } finally { await source.return(undefined) }
  }

  history(sessionId: string, options: { beforeSeq?: number; maxMessages?: number; signal?: AbortSignal } = {}): Promise<DshHistoryPage> {
    return this.readHistory({ kind: "session", sessionId }, options)
  }

  subagentHistory(address: AgentSubagentAddress, options: { beforeSeq?: number; maxMessages?: number; signal?: AbortSignal } = {}): Promise<DshHistoryPage> {
    return this.readHistory({ ...address, kind: "subagent" }, options)
  }

  subagentPrompt(
    address: AgentSubagentAddress & { mode: "continuable" },
    content: DshPromptContentPart[],
    options: { clientTimeZone?: string; signal?: AbortSignal } = {},
  ): Promise<{ messageId: string }> {
    if (address.mode !== "continuable") return Promise.reject(new Error("One-shot subagents cannot receive follow-up prompts"))
    if (content.some((part) => part.type === "image")) return Promise.reject(new Error("Image input is unavailable for subagent continuations"))
    return this.remote("subagents/prompt", { request: {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      mode: address.mode,
      content,
      ...(options.clientTimeZone ? { clientTimeZone: options.clientTimeZone } : {}),
    } }, options.signal)
  }

  subagentInterrupt(
    address: AgentSubagentAddress & { mode: "continuable" },
  ): Promise<{ accepted: true }> {
    if (address.mode !== "continuable") return Promise.reject(new Error("One-shot subagents do not support continuation interrupts"))
    return this.remote("subagents/interruptByParent", {
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
    return Promise.all([
      this.remote<{ default: { provider: string; model: string; reasoningEffort?: string }; groups: unknown[]; failures: unknown[] }>("session/modelCatalog", {}, signal),
      this.history(sessionId, { maxMessages: 1, signal }),
      this.remote<{ id: string }[]>("llm/listProviders", {}, signal),
    ]).then(([catalog, history, providers]) => {
      const projection = history.projections?.values.modelSelection as { next?: { provider: string; model: string; reasoningEffort?: string } } | undefined
      const current = projection?.next ?? catalog.default
      return { current, routable: providers.some(item => item.id === current.provider), groups: catalog.groups, failures: catalog.failures }
    })
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
    return this.remote("session/selectModel", { request: payload }, signal)
  }

  cancel(sessionId: string, signal?: AbortSignal): Promise<{ accepted: true }> {
    return this.remote("session/cancel", { request: { sessionId } }, signal)
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
    const request = this.eventRequests.get(requestId)
    if (!request) return { accepted: false, reason: "request is no longer pending" }
    await this.remote("$events/result", {
      clientId: request.clientId, eventId: requestId,
      outcome: result.ok ? { kind: "result", value: result.value } : { kind: "rejected", error: { name: "Error", ...result.error } },
    }, signal)
    return { accepted: true }
  }

  respondApproval(
    requestId: string,
    payload: { sessionId: string; approvalId: string; outcome: "allowed-once" | "rejected" },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respond(requestId, payload.outcome, signal)
  }

  respondToQuestions(
    requestId: string,
    payload: { sessionId: string; answer: unknown },
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.respond(requestId, payload.answer, signal)
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

  private async firstStreamValue<T>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const stream = this.stream<T>(endpoint, args, signal)
    try {
      const item = await stream.next()
      if (item.done) throw new Error(`DSH ${endpoint} ended without a baseline`)
      return item.value
    } finally { await stream.return(undefined) }
  }

  /** One gateway logical stream. Cancellation closes its dedicated carrier. */
  async *stream<T>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal, onOpen?: () => void): AsyncGenerator<T> {
    if (signal?.aborted) return
    const url = new URL("/api/remote.mux", `${this.baseUrl}/`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = this.createWebSocket(url.href)
    const streamId = this.makeRpcId()
    type Item = { value: T } | { error: Error } | { done: true }
    const queue: Item[] = []
    let wake: ((item: Item) => void) | undefined
    const put = (item: Item) => { if (wake) { const resolve = wake; wake = undefined; resolve(item) } else queue.push(item) }
    const opened = () => {
      socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }))
      onOpen?.()
    }
    const message = (event: Event) => {
      try {
        const frame = JSON.parse(String((event as MessageEvent).data))
        if (frame.streamId !== streamId) throw new Error("DSH remote stream returned an unexpected stream identity")
        if (frame.type === "item") put({ value: frame.value as T })
        else if (frame.type === "end") put({ done: true })
        else if (frame.type === "error") put({ error: new DshRpcError(frame.error) })
        else throw new Error("DSH remote stream returned an unknown frame")
      } catch (error) { put({ error: error instanceof Error ? error : new Error(String(error)) }) }
    }
    const failed = () => put({ error: new Error(`DSH ${endpoint} WebSocket failed`) })
    const closed = () => put(signal?.aborted ? { done: true } : { error: new Error(`DSH ${endpoint} WebSocket closed`) })
    const aborted = () => { put({ done: true }); if (socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel", streamId })); if (socket.readyState < 2) socket.close(1000, "aborted") }
    socket.addEventListener("open", opened)
    socket.addEventListener("message", message)
    socket.addEventListener("error", failed)
    socket.addEventListener("close", closed)
    signal?.addEventListener("abort", aborted, { once: true })
    if (signal?.aborted) aborted()
    try {
      for (;;) {
        const item = queue.shift() ?? await new Promise<Item>(resolve => { wake = resolve })
        if ("done" in item) return
        if ("error" in item) throw item.error
        yield item.value
      }
    } finally {
      signal?.removeEventListener("abort", aborted)
      socket.removeEventListener("open", opened)
      socket.removeEventListener("message", message)
      socket.removeEventListener("error", failed)
      socket.removeEventListener("close", closed)
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "cancel", streamId }))
      if (socket.readyState < 2) socket.close(1000, "iterator closed")
    }
  }

  private readonly eventRequests = new Map<string, { clientId: string; sessionId: string; kind: "approval" | "question" }>()

  async *events(signal?: AbortSignal, onOpen?: () => void, address?: { kind: "session"; sessionId: string } | (AgentSubagentAddress & { kind: "subagent" })): AsyncGenerator<DshMuxEnvelope> {
    if (address) { yield* this.journalEvents(signal, onOpen, address); return }
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    const sources = [this.journalEvents(controller.signal, onOpen), this.controlEvents(controller.signal)]
    const pending = new Map(sources.map((source, index) => [index, source.next().then(result => ({ index, result }))]))
    try {
      while (pending.size) {
        const { index, result } = await Promise.race(pending.values())
        if (result.done) { pending.delete(index); continue }
        pending.set(index, sources[index]!.next().then(result => ({ index, result })))
        yield result.value
      }
    } finally {
      controller.abort()
      signal?.removeEventListener("abort", abort)
      await Promise.allSettled(pending.values())
      await Promise.allSettled(sources.map(source => source.return(undefined)))
    }
  }

  private async *controlEvents(signal: AbortSignal): AsyncGenerator<DshMuxEnvelope> {
    type Projection = { asOfSeq: number; values: Record<string, unknown> }
    type Control =
      | { type: "baseline"; value: { queues: Record<string, unknown[]>; jobs: Record<string, unknown[]>; projections: Record<string, Projection> } }
      | { type: "queue"; sessionId: string; items: unknown[] }
      | { type: "jobs"; sessionId: string; jobs: unknown[] }
      | { type: "projection"; sessionId: string; key: string; value: unknown; seq: number }
    for await (const frame of this.stream<Control>("session/control", {}, signal)) {
      if (frame.type === "baseline") {
        for (const [sessionId, items] of Object.entries(frame.value.queues)) yield { rpcId: "", payload: { type: "session/queue", sessionId, items } }
        for (const [sessionId, jobs] of Object.entries(frame.value.jobs)) yield { rpcId: "", payload: { type: "session/jobs", sessionId, jobs } }
        for (const [sessionId, projection] of Object.entries(frame.value.projections)) for (const [key, value] of Object.entries(projection.values)) yield { rpcId: "", payload: { type: "session/projection", sessionId, key, value, seq: projection.asOfSeq } }
      } else if (frame.type === "queue") yield { rpcId: "", payload: { ...frame, type: "session/queue" } }
      else if (frame.type === "jobs") yield { rpcId: "", payload: { ...frame, type: "session/jobs" } }
      else yield { rpcId: "", payload: { ...frame, type: "session/projection" } }
    }
  }

  /** Global human-interaction channel, or one explicitly addressed session journal. */
  private async *journalEvents(signal?: AbortSignal, onOpen?: () => void, address?: { kind: "session"; sessionId: string } | (AgentSubagentAddress & { kind: "subagent" })): AsyncGenerator<DshMuxEnvelope> {
    if (!address) {
      let clientId = ""
      type RemoteEvent =
        | { type: "ready"; clientId: string }
        | { type: "waterfall"; event: string; eventId: string; agentId: string; request: { toolName: string; callId?: string; reason?: string; questions: DshQuestionItem[] } }
        | { type: "cancel"; eventId: string }
        | { type: "emit"; event: string; args: unknown[] }
      const owned = new Set<string>()
      try {
        for await (const frame of this.stream<RemoteEvent>("$events", {}, signal)) {
          if (frame.type === "ready") { clientId = frame.clientId; onOpen?.(); continue }
          if (frame.type === "waterfall") {
            const kind = frame.event === "approval/request" ? "approval" : frame.event === "user-questions/request" ? "question" : undefined
            if (!kind) { await this.remote("$events/result", { clientId, eventId: frame.eventId, outcome: { kind: "next" } }, signal); continue }
            owned.add(frame.eventId)
            this.eventRequests.set(frame.eventId, { clientId, sessionId: frame.agentId, kind })
            yield { rpcId: frame.eventId, payload: kind === "approval"
              ? { type: "approval/requested", sessionId: frame.agentId, approvalId: frame.eventId, toolName: frame.request.toolName, callId: frame.request.callId, reason: frame.request.reason }
              : { type: "question/requested", sessionId: frame.agentId, questions: frame.request.questions } }
          } else if (frame.type === "cancel") {
            const request = this.eventRequests.get(frame.eventId)
            this.eventRequests.delete(frame.eventId)
            if (request) yield { rpcId: frame.eventId, payload: request.kind === "approval"
              ? { type: "approval/resolved", sessionId: request.sessionId, approvalId: frame.eventId, outcome: "cancelled" }
              : { type: "question/resolved", sessionId: request.sessionId, questionRpcId: frame.eventId, outcome: "cancelled" } }
          }
        }
      } finally { for (const id of owned) this.eventRequests.delete(id) }
      return
    }
    const sessionId = address.kind === "session" ? address.sessionId : address.childSessionId
    type Follow =
      | { type: "snapshot"; cursor: number; records: DshHistoryEntry[]; assistantStream?: { activeAttempt?: { step: number; startedAfterSeq: number; stream: unknown[] } } }
      | { type: "event"; event: DshSessionEvent }
      | { type: "assistant-stream"; frame: { type: "start"; step: number; startedAfterSeq: number } | { type: "chunk"; time: number; chunk: unknown } | { type: "end" } }
    let step: number | undefined
    let lastSeq = -1
    for await (const frame of this.stream<Follow>("session/follow", { request: { address, assistantStream: true } }, signal)) {
      if (frame.type === "snapshot") {
        lastSeq = frame.cursor
        yield { rpcId: "", payload: { type: "session/subscribed", sessionId, lastSeq } }
        onOpen?.()
      } else if (frame.type === "event") {
        lastSeq = frame.event.seq
        yield { rpcId: "", payload: { type: "session/event", sessionId, event: frame.event } }
      } else if (frame.frame.type === "start") {
        step = frame.frame.step
      } else if (frame.frame.type === "chunk") {
        yield { rpcId: "", payload: { type: "session/event", sessionId, event: { type: "assistant/chunk", seq: lastSeq, time: frame.frame.time, data: { step, chunk: frame.frame.chunk } } } }
      }
    }
  }

  async openEvents(signal?: AbortSignal, address?: { kind: "session"; sessionId: string } | (AgentSubagentAddress & { kind: "subagent" })): Promise<AsyncIterableIterator<DshMuxEnvelope>> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    const frames = this.events(controller.signal, undefined, address)
    try {
      const first = await frames.next()
      if (first.done) throw new Error("DSH event stream ended before its opening snapshot")
      let buffered: IteratorResult<DshMuxEnvelope> | undefined = first
      const close = () => { controller.abort(); signal?.removeEventListener("abort", abort) }
      const iterator: AsyncIterableIterator<DshMuxEnvelope> = {
        next: async () => { if (buffered) { const result = buffered; buffered = undefined; return result } return frames.next() },
        return: async () => { close(); return frames.return(undefined) },
        [Symbol.asyncIterator]: () => iterator,
      }
      return iterator
    } catch (error) { abort(); signal?.removeEventListener("abort", abort); await frames.return(undefined); throw error }
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

export { durableContentImages } from "./content-images";

export { retryProgress, upsertRetryTimeline } from "./retry";
