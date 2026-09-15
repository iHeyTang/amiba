import { describe, expect, it, vi } from "vitest"
import { DshApiClient, type DshWebSocketLike } from "./index"

class FakeWebSocket implements DshWebSocketLike {
  readyState = 0
  readonly sent: Array<{ type: string; streamId: string; endpoint?: string; payload?: unknown }> = []
  readonly closes: Array<{ code?: number; reason?: string }> = []
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  addEventListener(type: string, listener: (event: Event) => void) {
    const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries)
  }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close(code?: number, reason?: string) { this.readyState = 3; this.closes.push({ code, reason }) }
  emit(type: string) { if (type === "open") this.readyState = 1; for (const listener of this.listeners.get(type) ?? []) listener(new Event(type)) }
  message(frame: unknown) { for (const listener of this.listeners.get("message") ?? []) listener(new MessageEvent("message", { data: JSON.stringify(frame) })) }
  item(value: unknown) { this.message({ type: "item", streamId: this.sent[0]!.streamId, value }) }
}

function harness() {
  const calls: Array<{ method: string; payload: unknown }> = []
  const sockets: FakeWebSocket[] = []
  const urls: string[] = []
  const client = new DshApiClient({
    baseUrl: "http://dsh.test", makeRpcId: () => "request-id",
    fetch: vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls.push({ method: body.method, payload: body.payload })
      return Response.json({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value: { accepted: true } } })
    }),
    createWebSocket: url => { urls.push(url); const socket = new FakeWebSocket(); sockets.push(socket); return socket },
  })
  return { client, calls, sockets, urls }
}
const address = { kind: "session" as const, sessionId: "s-1" }
const snapshot = { type: "snapshot", cursor: 7, records: [], hasMore: false, projections: { asOfSeq: 7, values: {} } }

describe("DSH 0.1.5 Remote transport", () => {
  it("uses generated named request parameters and preserves custom namespaces", async () => {
    const { client, calls } = harness()
    await client.createSession({ sessionId: "s-1" }); await client.listSessions()
    await client.searchSessions("needle"); await client.renameSession("s-1", "Name"); await client.forkSession("s-1", 4)
    await client.call("amibaExample/list", { args: {} })
    expect(calls).toEqual([
      { method: "session/create", payload: { args: { request: { sessionId: "s-1" } } } },
      { method: "session/list", payload: { args: { _request: {} } } },
      { method: "session/search", payload: { args: { request: { query: "needle" } } } },
      { method: "session/rename", payload: { args: { request: { sessionId: "s-1", title: "Name" } } } },
      { method: "session/fork", payload: { args: { request: { sessionId: "s-1", atSeq: 4 } } } },
      { method: "amibaExample/list", payload: { args: {} } },
    ])
  })
  it("sends a prompt identity and retains image content", async () => {
    const { client, calls } = harness()
    const content = [{ type: "image" as const, mediaType: "image/png" as const, data: "YWJj" }]
    await client.prompt("s-1", content)
    expect(calls[0]).toEqual({ method: "session/prompt", payload: { args: { request: { requestId: "request-id", sessionId: "s-1", mode: "queue", content } } } })
  })
  it("keeps the direct-parent address on child continuation and rejects one-shot writes", async () => {
    const { client, calls } = harness()
    const child = { parentSessionId: "parent", childSessionId: "child", mode: "continuable" as const }
    await client.subagentPrompt(child, [{ type: "text", text: "Continue" }]); await client.subagentInterrupt(child)
    expect(calls).toEqual([
      { method: "subagents/prompt", payload: { args: { request: { ...child, content: [{ type: "text", text: "Continue" }] } } } },
      { method: "subagents/interruptByParent", payload: { args: child } },
    ])
    await expect(client.subagentPrompt({ ...child, mode: "one-shot" } as never, [])).rejects.toThrow("One-shot")
    await expect(client.subagentInterrupt({ ...child, mode: "one-shot" } as never)).rejects.toThrow("One-shot")
    expect(calls).toHaveLength(2)
  })
  it("waits for the authoritative follow snapshot and retains that first frame", async () => {
    const { client, sockets, urls } = harness()
    const opening = client.openEvents(undefined, address)
    const socket = sockets[0]!; socket.emit("open")
    expect(urls).toEqual(["ws://dsh.test/api/remote.mux"])
    expect(socket.sent[0]).toEqual({ type: "open", streamId: "request-id", endpoint: "session/follow", payload: { args: { request: { address, assistantStream: true } } } })
    socket.item(snapshot)
    const stream = await opening
    expect((await stream.next()).value.payload).toEqual({ type: "session/subscribed", sessionId: "s-1", lastSeq: 7 })
    await stream.return!(); expect(socket.sent.at(-1)?.type).toBe("cancel"); expect(socket.closes).toHaveLength(1)
  })
  it("adapts live assistant chunks without inventing durable events", async () => {
    const { client, sockets } = harness()
    const stream = client.events(undefined, undefined, address); const first = stream.next()
    const socket = sockets[0]!; socket.emit("open"); socket.item(snapshot); await first
    const next = stream.next()
    socket.item({ type: "assistant-stream", frame: { type: "start", step: 3, startedAfterSeq: 7 } })
    socket.item({ type: "assistant-stream", frame: { type: "chunk", time: 10, chunk: { type: "text-delta", text: "Hello" } } })
    expect((await next).value?.payload).toMatchObject({ type: "session/event", event: { type: "assistant/chunk", data: { step: 3, chunk: { text: "Hello" } } } })
    await stream.return(undefined)
  })
  it("reads history from the follow opening and releases its carrier", async () => {
    const { client, sockets } = harness(); const history = client.history("s-1")
    sockets[0]!.emit("open"); sockets[0]!.item(snapshot)
    expect(await history).toEqual({ events: [], hasMore: false, projections: snapshot.projections })
    expect(sockets[0]!.closes).toHaveLength(1)
  })
  it.each(["error", "close"])("releases a carrier when %s occurs before readiness", async type => {
    const { client, sockets } = harness(); const opening = client.openEvents(undefined, address)
    sockets[0]!.emit(type); await expect(opening).rejects.toThrow("WebSocket"); expect(sockets[0]!.closes).toHaveLength(1)
  })
  it("cancels an opening and does not lose a registration-time abort", async () => {
    const controller = new AbortController(); const socket = new FakeWebSocket()
    const client = new DshApiClient({ baseUrl: "http://dsh.test", createWebSocket: () => { controller.abort(); return socket } })
    await expect(client.openEvents(controller.signal, address)).rejects.toThrow("opening snapshot")
    expect(socket.closes).toHaveLength(1)
  })
  it("surfaces host errors and rejects mismatched stream identities", async () => {
    const { client, sockets } = harness(); const stream = client.stream("session/control", {}); const first = stream.next()
    sockets[0]!.emit("open"); sockets[0]!.message({ type: "item", streamId: "wrong", value: {} })
    await expect(first).rejects.toThrow("identity")
    const other = new DshApiClient({ baseUrl: "http://dsh.test", makeRpcId: () => "id", fetch: async () => Response.json({ type: "server-response", rpcId: "id", result: { ok: false, error: { code: "session/missing", message: "missing" } } }) })
    await expect(other.cancel("missing")).rejects.toMatchObject({ name: "DshRpcError", code: "session/missing" })
  })
})
