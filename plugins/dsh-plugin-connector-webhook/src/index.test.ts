import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWebhookProvider,
  apply,
  WEBHOOK_PATH,
  type WebServerFace,
} from "./index.js";

type Route = Parameters<WebServerFace["register"]>[0];
const tokenA = "a".repeat(64),
  tokenB = "b".repeat(64);
function harness() {
  const routes = new Map<string, Route>();
  const server: WebServerFace = {
    register(route) {
      if (routes.has(route.path)) throw new Error("duplicate_route");
      routes.set(route.path, route);
      return () => {
        routes.delete(route.path);
      };
    },
  };
  const provider = createWebhookProvider(server);
  const onInbound = vi.fn(async (_envelope: unknown) => ({
    accepted: true,
    duplicate: false,
    sessionId: "session-1",
  }));
  async function start(id: string, token: string, extra = {}) {
    return provider.start({
      connectId: id,
      config: { token, ...extra },
      onInbound,
      setStatus: vi.fn(),
    });
  }
  async function request(
    id: string,
    {
      token = tokenA,
      method = "POST",
      contentType = "application/json",
      body = { id: "event-1", text: "hello" },
    } = {},
  ) {
    const req = Object.assign(
      Readable.from([typeof body === "string" ? body : JSON.stringify(body)]),
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": contentType,
        },
      },
    );
    let status = 0,
      response: Record<string, unknown> = {};
    const res = {
      writeHead(value: number) {
        status = value;
      },
      setHeader: vi.fn(),
      end(value: string) {
        response = JSON.parse(value);
      },
    };
    const route = routes.get(`${WEBHOOK_PATH}/${id}`);
    if (!route) return { status: 404, response };
    await route.handler(req as never, res as never);
    return { status, response };
  }
  return { server, routes, provider, start, request, onInbound };
}
afterEach(() => vi.unstubAllGlobals());

describe("Webhook connector", () => {
  it("registers only with connector-core; creates no independent messaging management surface", () => {
    const { server } = harness();
    const registerProvider = vi.fn(() => vi.fn());
    apply({
      webServer: server,
      amibaConnectors: { registerProvider },
      effect: (fn: () => void) => fn(),
    } as never);
    expect(registerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "webhook",
        messaging: { ownerPairing: false },
      }),
    );
  });
  it("isolates per-account URLs, credentials and teardown", async () => {
    const h = harness();
    const a = await h.start("a", tokenA),
      b = await h.start("b", tokenB);
    expect((await h.request("a")).status).toBe(202);
    expect((await h.request("b")).status).toBe(401);
    expect((await h.request("b", { token: tokenB })).status).toBe(202);
    await a.stop();
    expect((await h.request("a")).status).toBe(404);
    expect((await h.request("b", { token: tokenB })).status).toBe(202);
    await b.stop();
    expect(h.routes.size).toBe(0);
  });
  it("forwards conversation identity and duplicate results, not channel IDs", async () => {
    const h = harness();
    await h.start("a", tokenA);
    await h.request("a", {
      body: {
        id: "event-1",
        text: "hello",
        sender: "alice",
        conversation: "thread-1",
      } as never,
    });
    expect(h.onInbound).toHaveBeenLastCalledWith({
      id: "event-1",
      text: "hello",
      sender: "alice",
      conversation: { key: "thread-1", kind: "p2p" },
    });
    h.onInbound.mockResolvedValueOnce({
      accepted: true,
      duplicate: true,
      sessionId: "session-1",
    });
    expect((await h.request("a")).status).toBe(200);
  });
  it("rejects unauthenticated, disallowed, malformed and oversized requests before routing", async () => {
    const h = harness();
    await h.start("a", tokenA, { allowedSenders: ["alice"] });
    expect((await h.request("a", { token: "wrong" })).status).toBe(401);
    expect((await h.request("a")).status).toBe(403);
    expect((await h.request("a", { method: "GET" })).status).toBe(405);
    expect((await h.request("a", { contentType: "text/plain" })).status).toBe(
      415,
    );
    expect((await h.request("a", { body: "{" as never })).status).toBe(400);
    expect(
      (await h.request("a", { body: "x".repeat(1024 * 1024 + 1) as never }))
        .status,
    ).toBe(413);
    expect(h.onInbound).not.toHaveBeenCalled();
  });
  it("does not acknowledge failed routing or expose internal errors", async () => {
    const h = harness();
    await h.start("a", tokenA);
    h.onInbound.mockRejectedValueOnce(new Error("sensitive-internal-error"));
    expect(await h.request("a")).toEqual({
      status: 503,
      response: { ok: false, error: "connection_unavailable" },
    });
  });
  it("projects settings without credentials and accepts partial edits without resetting unrelated fields", async () => {
    const { provider } = harness();
    const config = {
      token: tokenA,
      outboundUrl: "https://example.com/replies",
      allowedSenders: ["alice"],
    };
    expect(provider.settings!(config)).toEqual({
      outboundUrl: config.outboundUrl,
      allowedSenders: ["alice"],
    });
    expect(provider.configure!(config, { token: tokenB })).toEqual({
      ...config,
      token: tokenB,
    });
    expect(() => provider.configure!(config, { arbitrary: true })).toThrow();
    await expect(
      provider.validate({
        ...config,
        outboundUrl: "http://example.com/replies",
      }),
    ).rejects.toThrow("outbound_url_requires_https");
    await expect(
      provider.validate({
        ...config,
        outboundUrl: "http://[::1]:1234/replies",
      }),
    ).resolves.toBeUndefined();
  });
  it("rotating one account credential invalidates only its previous token", async () => {
    const h = harness();
    const runtime = await h.start("a", tokenA);
    await h.start("b", tokenA);
    await runtime.stop();
    await h.start("a", tokenB);
    expect((await h.request("a")).status).toBe(401);
    expect((await h.request("a", { token: tokenB })).status).toBe(202);
    expect((await h.request("b")).status).toBe(202);
  });
  it("delivers connection-shaped replies using HTTPS without following redirects", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const h = harness();
    const runtime = await h.start("a", tokenA, {
      outboundUrl: "https://example.com/replies",
    });
    await runtime.deliver!(
      { key: "thread-1", kind: "p2p" },
      {
        id: "reply-1",
        channelId: "internal-channel",
        sessionId: "internal-session",
        inReplyTo: "event-1",
        text: "reply",
        createdAt: "today",
      },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/replies",
      expect.objectContaining({ redirect: "error", method: "POST" }),
    );
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options[1].body))).toEqual({
      id: "reply-1",
      connectId: "a",
      conversation: "thread-1",
      inReplyTo: "event-1",
      text: "reply",
      createdAt: "today",
    });
  });
});
