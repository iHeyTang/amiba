// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectorAccounts,
  ConnectView,
} from "@amiba/dsh-plugin-connector-core";
import { DingtalkPersonalService } from "./personal.js";
import { createDingtalkResourceSource } from "./resources.js";
const now = 1_000_000;
const grant = (userId = "corp:alice", expiresAt = now + 7200000) => ({
  clientId: "client",
  userId,
  name: userId,
  accessToken: "secret-token",
  refreshToken: "secret-refresh",
  expiresAt,
  generation: userId + "-generation",
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function fixture(initial: Record<string, unknown> = {}) {
  const states = new Map(Object.entries(initial));
  const rows = ["a", "b"].map(
    (id) =>
      ({
        id,
        provider: "dingtalk",
        name: `Account ${id}`,
        enabled: true,
      }) as ConnectView,
  );
  const controllers = new Map<string, Set<AbortController>>();
  const accounts: ConnectorAccounts = {
    list: async () => rows,
    invalidate(id) {
      for (const controller of controllers.get(id) ?? []) controller.abort();
    },
    async run(id, operation, outer) {
      const connect = rows.find((row) => row.id === id);
      if (!connect?.enabled) throw new Error("connection_unavailable");
      const controller = new AbortController(),
        pending = controllers.get(id) ?? new Set();
      controllers.set(id, pending);
      pending.add(controller);
      const signal = AbortSignal.any([
        controller.signal,
        ...(outer ? [outer] : []),
      ]);
      try {
        signal.throwIfAborted();
        const value = await operation({
          connect,
          config: { appId: "app", appSecret: "app-secret", domain: "feishu" },
          state: states.get(id),
          signal,
          updateState: async (mutate) => {
            signal.throwIfAborted();
            states.set(id, mutate(states.get(id)));
          },
        });
        signal.throwIfAborted();
        return value;
      } finally {
        pending.delete(controller);
      }
    },
  };
  let clock = now;
  const fetch = vi.fn<typeof globalThis.fetch>();
  const personal = new DingtalkPersonalService(accounts, {
    fetch,
    now: () => clock,
  });
  return {
    states,
    accounts,
    personal,
    fetch,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const rpc = (value: unknown) =>
  json({
    result: { content: [{ type: "text", text: JSON.stringify(value) }] },
  });
const signal = () => new AbortController().signal;
describe("DingTalk personal documents", () => {
  it("keeps credentials out of status", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: false } });
    expect(JSON.stringify(await h.personal.status("a"))).not.toContain(
      "secret",
    );
  });
  it("requires personal auth on an existing bot connection", async () => {
    const h = fixture();
    const r = await createDingtalkResourceSource(h.personal).search(
      { query: "文档", connectionId: "a" },
      "model",
      signal(),
    );
    expect(r.unavailable[0]?.reason).toBe("personal_authorization_required");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("denies model before refreshing and still permits user preview", async () => {
    const h = fixture({
      a: { user: grant("corp:alice", now), modelAccess: false },
    });
    await expect(
      h.personal.withUser("a", true, async () => "no"),
    ).rejects.toThrow("agent_access_disabled");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("searches documents and preserves account identity", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    h.fetch.mockResolvedValue(
      rpc({
        nodes: [
          {
            nodeId: "doc",
            name: "<b>日程</b>",
            url: "https://alidocs.dingtalk.com/doc",
          },
        ],
      }),
    );
    const r = await createDingtalkResourceSource(h.personal).search(
      { query: "*" },
      "model",
      signal(),
    );
    expect(r.items[0]).toMatchObject({
      title: "日程",
      ref: {
        source: "dingtalk",
        connectionId: "a",
        identity: "corp:alice",
        id: "doc",
      },
    });
    expect(r.unavailable).toEqual([
      {
        source: "dingtalk",
        connectionId: "b",
        reason: "personal_authorization_required",
      },
    ]);
    expect(
      JSON.parse(h.fetch.mock.calls[0]![1]!.body as string).params,
    ).toEqual({ name: "search_documents", arguments: { pageSize: 20 } });
  });
  it("rejects malformed search responses rather than claiming empty docs", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    h.fetch.mockResolvedValue(rpc({ unexpected: true }));
    const r = await createDingtalkResourceSource(h.personal).search(
      { query: "文档", connectionId: "a" },
      "model",
      signal(),
    );
    expect(r.unavailable[0]?.reason).toBe("search_failed");
  });
  it("binds reads to the authorized user", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    await expect(
      createDingtalkResourceSource(h.personal).read(
        {
          source: "dingtalk",
          connectionId: "a",
          identity: "other",
          kind: "doc",
          id: "d",
        },
        "model",
        signal(),
      ),
    ).rejects.toThrow("resource_identity_changed");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("reads markdown and limits returned content", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: false } });
    h.fetch
      .mockResolvedValueOnce(rpc({ name: "Doc" }))
      .mockResolvedValueOnce(rpc({ markdown: "x".repeat(40001) }));
    const r = await createDingtalkResourceSource(h.personal).read(
      {
        source: "dingtalk",
        connectionId: "a",
        identity: "corp:alice",
        kind: "doc",
        id: "d",
      },
      "preview",
      signal(),
    );
    expect(r.text).toHaveLength(40000);
    expect(r.truncated).toBe(true);
  });
  it("does not expose write operations", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    await expect(
      h.personal.withUser("a", true, (call) => call("delete_document", {})),
    ).rejects.toThrow("unsupported_document_operation");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("reports permission failures distinctly", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    h.fetch.mockResolvedValue(new Response("denied", { status: 403 }));
    const r = await createDingtalkResourceSource(h.personal).search(
      { query: "文档", connectionId: "a" },
      "model",
      signal(),
    );
    expect(r.unavailable[0]?.reason).toBe("permission_required");
  });
  it("prevents a result arriving after disconnect from escaping", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    await expect(
      h.personal.withUser("a", true, async () => {
        await h.personal.disconnect("a");
        return "private";
      }),
    ).rejects.toThrow();
    expect((h.states.get("a") as any).user).toBeUndefined();
  });
  it("refreshes once for simultaneous reads", async () => {
    const h = fixture({
      a: { user: grant("corp:alice", now), modelAccess: true },
    });
    h.fetch.mockResolvedValue(
      json({ accessToken: "new-token", expiresIn: 7200 }),
    );
    await Promise.all([
      h.personal.withUser("a", true, async () => 1),
      h.personal.withUser("a", true, async () => 2),
    ]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("completes a device flow without exposing private codes", async () => {
    const h = fixture();
    h.fetch
      .mockResolvedValueOnce(json({ success: true, result: "client" }))
      .mockResolvedValueOnce(
        json({
          success: true,
          result: {
            deviceCode: "private-code",
            verificationUriComplete:
              "https://login.dingtalk.com/oauth?code=public",
            userCode: "public",
            interval: 2,
          },
        }),
      );
    const f = await h.personal.begin("a");
    expect(JSON.stringify(f)).not.toContain("private-code");
    await expect(h.personal.poll("b", f.id)).rejects.toThrow(
      "authorization_not_found",
    );
    h.advance(3000);
    h.fetch
      .mockResolvedValueOnce(
        json({ success: true, result: { authCode: "auth" } }),
      )
      .mockResolvedValueOnce(
        json({
          accessToken: "secret",
          refreshToken: "refresh",
          corpId: "corp",
          userId: "alice",
          expiresIn: 7200,
        }),
      );
    expect((await h.personal.poll("a", f.id)).state).toBe("completed");
    expect((await h.personal.status("a")).modelAccess).toBe(false);
  });
  it("cancels a pending flow", async () => {
    const h = fixture();
    h.fetch
      .mockResolvedValueOnce(json({ success: true, result: "client" }))
      .mockResolvedValueOnce(
        json({
          success: true,
          result: {
            deviceCode: "private",
            verificationUriComplete: "https://login.dingtalk.com/oauth",
          },
        }),
      );
    const f = await h.personal.begin("a");
    await h.personal.cancel("a", f.id);
    await expect(h.personal.poll("a", f.id)).rejects.toThrow(
      "authorization_not_found",
    );
  });
});

it("returns an expired flow without an abort error", async () => {
  const h = fixture();
  h.fetch
    .mockResolvedValueOnce(json({ success: true, result: "client" }))
    .mockResolvedValueOnce(
      json({
        success: true,
        result: {
          deviceCode: "private",
          verificationUriComplete: "https://login.dingtalk.com/oauth",
          expiresIn: 1,
        },
      }),
    );
  const f = await h.personal.begin("a");
  h.advance(2000);
  expect((await h.personal.poll("a", f.id)).state).toBe("expired");
});
