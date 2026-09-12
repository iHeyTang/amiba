import { describe, expect, it, vi } from "vitest"
import { DshApiClient, DshRpcError, type DshWebSocketLike } from "./index"

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("DshApiClient", () => {
  it("establishes an empty mux before any child subscription and closes an unread stream", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } }));
    const client = new DshApiClient({ baseUrl: "http://dsh.test", fetch });
    const controller = new AbortController();
    const stream = await client.openEvents(controller.signal);
    expect(fetch).toHaveBeenCalledWith("http://dsh.test/api/events.mux", { signal: controller.signal });
    await stream.return!();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("reads split SSE frames after header readiness without losing child data", async () => {
    const frame = { type: "server-request", method: "session/subscribed", rpcId: "child-frame", payload: { type: "session/subscribed", sessionId: "子会话", lastSeq: 0 } };
    const bytes = new TextEncoder().encode(`: keepalive\n\ndata: ${JSON.stringify(frame)}\n\n`);
    const client = new DshApiClient({ baseUrl: "http://dsh.test", fetch: (async () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
      controller.close();
    } }))) as typeof fetch });
    const stream = await client.openEvents();
    expect(await stream.next()).toEqual({ done: false, value: { rpcId: frame.rpcId, payload: frame.payload } });
    expect((await stream.next()).done).toBe(true);
  });

  it("propagates mux HTTP failures before announcing readiness", async () => {
    const client = new DshApiClient({ baseUrl: "http://dsh.test", fetch: (async () => new Response("Unavailable", { status: 503 })) as typeof fetch });
    await expect(client.openEvents()).rejects.toThrow("HTTP 503");
  });

  it("routes child continuation and interruption through the exact direct-parent address", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls.push({ method: body.method, payload: body.payload });
        return jsonResponse({ type: "server-response", rpcId: body.rpcId, result: {
          ok: true, value: body.method === "subagent.prompt" ? { messageId: "message-child" } : { accepted: true },
        } });
      }) as typeof fetch,
    });
    const address = { parentSessionId: "parent", childSessionId: "child", mode: "continuable" as const };
    const content = [{ type: "text" as const, text: "Continue" }];
    await expect(client.subagentPrompt(address, content, { clientTimeZone: "Asia/Shanghai" })).resolves.toEqual({ messageId: "message-child" });
    await expect(client.subagentInterrupt(address)).resolves.toEqual({ accepted: true });
    expect(calls).toEqual([
      { method: "subagent.prompt", payload: { ...address, content, clientTimeZone: "Asia/Shanghai" } },
      { method: "subagent.interrupt", payload: address },
    ]);
  });

  it("does not send continuation RPCs for one-shot children even from untyped callers", async () => {
    const fetch = vi.fn();
    const client = new DshApiClient({ baseUrl: "http://dsh.test", fetch });
    const address = { parentSessionId: "parent", childSessionId: "child", mode: "one-shot" };
    await expect(client.subagentPrompt(address as never, [])).rejects.toThrow("One-shot");
    await expect(client.subagentInterrupt(address as never)).rejects.toThrow("One-shot");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("matches the pinned official client's rejection of child image prompts", async () => {
    const fetch = vi.fn();
    const client = new DshApiClient({ baseUrl: "http://dsh.test", fetch });
    await expect(client.subagentPrompt({ parentSessionId: "parent", childSessionId: "child", mode: "continuable" }, [
      { type: "image", mediaType: "image/png", data: "aW1hZ2U=", name: "image.png" },
    ])).rejects.toThrow("Image input is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses native DSH RPC envelopes", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      expect(body).toEqual({
        type: "client-request",
        rpcId: "rpc-1",
        method: "session.create",
        payload: { sessionId: "s-1" },
      })
      return jsonResponse({
        type: "server-response",
        rpcId: body.rpcId,
        result: { ok: true, value: { sessionId: "s-1" } },
      })
    })
    const client = new DshApiClient({
      baseUrl: "http://127.0.0.1:1234/",
      fetch: fetchMock as typeof fetch,
      makeRpcId: () => "rpc-1",
    })
    await expect(client.createSession({ sessionId: "s-1" })).resolves.toEqual({ sessionId: "s-1" })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/api/session.create",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("preserves Typert Remote namespace separators in DSH API routes", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rpcId: string }
      return jsonResponse({
        type: "server-response",
        rpcId: body.rpcId,
        result: { ok: true, value: { records: [], failures: [] } },
      })
    })
    const client = new DshApiClient({
      baseUrl: "http://127.0.0.1:1234",
      fetch: fetchMock as typeof fetch,
      makeRpcId: () => "rpc-remote",
    })

    await client.call("amibaAttachments/list", { args: {} })

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/api/amibaAttachments/list",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("sends native image content parts without flattening them into text", async () => {
    let seenPayload: unknown
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      makeRpcId: () => "image-rpc",
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          rpcId: string
          payload: unknown
        }
        seenPayload = body.payload
        return jsonResponse({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { accepted: true } },
        })
      }) as typeof fetch,
    })

    await client.prompt("s-image", [
      { type: "text", text: "What is shown?" },
      {
        type: "image",
        mediaType: "image/png",
        data: "iVBORw0KGgo=",
        name: "screen.png",
      },
    ])

    expect(seenPayload).toEqual({
      sessionId: "s-image",
      mode: "queue",
      content: [
        { type: "text", text: "What is shown?" },
        {
          type: "image",
          mediaType: "image/png",
          data: "iVBORw0KGgo=",
          name: "screen.png",
        },
      ],
    })
  })

  it("surfaces business errors with their DSH code", async () => {
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      fetch: (async () => jsonResponse({
        type: "server-response",
        rpcId: "rpc-2",
        result: { ok: false, error: { code: "session-not-found", message: "missing" } },
      })) as typeof fetch,
      makeRpcId: () => "rpc-2",
    })
    await expect(client.cancel("missing")).rejects.toMatchObject({
      name: "DshRpcError",
      code: "session-not-found",
      message: "missing",
    })
  })

  it("exposes the native list, search, rename, and fork session methods", async () => {
    const seen: Array<{ method: string; payload: unknown }> = []
    let rpc = 0
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      makeRpcId: () => `rpc-${++rpc}`,
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          rpcId: string
          method: string
          payload: unknown
        }
        seen.push({ method: body.method, payload: body.payload })
        const values: Record<string, unknown> = {
          "session.list": { items: [] },
          "session.search": { items: [], hasMore: false },
          "session.rename": { title: "Renamed", seq: 4 },
          "session.fork": { sessionId: "child" },
        }
        return jsonResponse({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: values[body.method] },
        })
      }) as typeof fetch,
    })

    await client.listSessions()
    await client.searchSessions("needle")
    await client.renameSession("parent", "Renamed")
    await client.forkSession("parent", 12)

    expect(seen).toEqual([
      { method: "session.list", payload: {} },
      { method: "session.search", payload: { query: "needle" } },
      {
        method: "session.rename",
        payload: { sessionId: "parent", title: "Renamed" },
      },
      {
        method: "session.fork",
        payload: { sessionId: "parent", atSeq: 12 },
      },
    ])
  })

  it("uses DSH workspace registry methods without inventing product state", async () => {
    const seen: Array<{ method: string; payload: unknown }> = []
    let rpc = 0
    const workspace = {
      workspaceId: "w-1",
      path: "/repo",
      title: "repo",
      sessionIds: [],
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      makeRpcId: () => `workspace-${++rpc}`,
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          rpcId: string
          method: string
          payload: unknown
        }
        seen.push({ method: body.method, payload: body.payload })
        const values: Record<string, unknown> = {
          "workspace.list": { items: [workspace], archivedSessionIds: [] },
          "workspace.create": { workspace, created: true },
          "workspace.rename": { workspace: { ...workspace, title: "Project" } },
          "workspace.delete": { deleted: true },
          "workspace.insertBefore": { workspaceIds: ["w-1"] },
          "workspace.insertSessionBefore": {
            workspace: { ...workspace, sessionIds: ["s-1"] },
          },
          "workspace.archiveSession": { archivedSessionIds: ["s-1"] },
        }
        return jsonResponse({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: values[body.method] },
        })
      }) as typeof fetch,
    })

    await client.listWorkspaces()
    await client.createWorkspace("/repo")
    await client.renameWorkspace("w-1", "Project")
    await client.reorderWorkspace("w-1")
    await client.reorderWorkspaceSession("w-1", "s-1")
    await client.archiveSession("s-1")
    await client.deleteWorkspace("w-1")

    expect(seen).toEqual([
      { method: "workspace.list", payload: {} },
      { method: "workspace.create", payload: { path: "/repo" } },
      {
        method: "workspace.rename",
        payload: { workspaceId: "w-1", title: "Project" },
      },
      { method: "workspace.insertBefore", payload: { workspaceId: "w-1" } },
      {
        method: "workspace.insertSessionBefore",
        payload: { workspaceId: "w-1", sessionId: "s-1" },
      },
      { method: "workspace.archiveSession", payload: { sessionId: "s-1" } },
      { method: "workspace.delete", payload: { workspaceId: "w-1" } },
    ])
  })

  it("uses the native DSH WebSocket downlink and unwraps server-request frames", async () => {
    const fetchMock = vi.fn()
    const socket = new FakeWebSocket()
    let webSocketUrl = ""
    const client = new DshApiClient({
      baseUrl: "http://127.0.0.1:4321/base",
      fetch: fetchMock as typeof fetch,
      createWebSocket: (url) => {
        webSocketUrl = url
        return socket
      },
    })
    const iterator = client.events()[Symbol.asyncIterator]()
    const pending = iterator.next()
    socket.message({
      type: "server-request",
      rpcId: "mux-1",
      method: "mux.event",
      payload: { type: "session/subscribed", sessionId: "s-1", lastSeq: 7 },
    })

    await expect(pending).resolves.toEqual({
      done: false,
      value: {
        rpcId: "mux-1",
        payload: { type: "session/subscribed", sessionId: "s-1", lastSeq: 7 },
      },
    })
    expect(webSocketUrl).toBe("ws://127.0.0.1:4321/api/events.mux")
    expect(fetchMock).not.toHaveBeenCalled()
    await iterator.return?.(undefined)
    expect(socket.closes).toEqual([{ code: 1000, reason: "iterator closed" }])
  })

  it("surfaces native stream errors from the WebSocket downlink", async () => {
    const socket = new FakeWebSocket()
    const client = new DshApiClient({
      baseUrl: "https://dsh.test",
      createWebSocket: () => socket,
    })
    const iterator = client.events()[Symbol.asyncIterator]()
    const pending = iterator.next()
    socket.message({
      type: "server-request",
      rpcId: "mux-error",
      method: "mux.event",
      payload: {
        type: "stream/error",
        error: { code: "stream-failed", message: "downlink failed" },
      },
    })

    await expect(pending).rejects.toMatchObject({
      name: "DshRpcError",
      code: "stream-failed",
      message: "downlink failed",
    })
  })

  it("closes the WebSocket when the event stream is aborted", async () => {
    const socket = new FakeWebSocket()
    const controller = new AbortController()
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      createWebSocket: () => socket,
    })
    const pending = client.events(controller.signal).next()
    controller.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(socket.closes).toEqual([{ code: 1000, reason: "aborted" }])
  })

  it("does not miss an abort that races WebSocket listener registration", async () => {
    const socket = new FakeWebSocket()
    const controller = new AbortController()
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      createWebSocket: () => {
        controller.abort()
        return socket
      },
    })

    await expect(client.events(controller.signal).next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    expect(socket.closes).toEqual([{ code: 1000, reason: "aborted" }])
  })

  it("rejects malformed native stream errors before constructing DshRpcError", async () => {
    const socket = new FakeWebSocket()
    const client = new DshApiClient({
      baseUrl: "http://dsh.test",
      createWebSocket: () => socket,
    })
    const pending = client.events().next()
    socket.message({
      type: "server-request",
      rpcId: "mux-invalid-error",
      method: "mux.event",
      payload: { type: "stream/error", error: { message: "missing code" } },
    })

    await expect(pending).rejects.toThrow("invalid stream error")
  })
})

class FakeWebSocket implements DshWebSocketLike {
  readyState = 1
  readonly closes: Array<{ code?: number; reason?: string }> = []
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 2
    this.closes.push({ code, reason })
  }

  message(value: unknown): void {
    const event = new MessageEvent("message", { data: JSON.stringify(value) })
    for (const listener of this.listeners.get("message") ?? []) listener(event)
  }
}
