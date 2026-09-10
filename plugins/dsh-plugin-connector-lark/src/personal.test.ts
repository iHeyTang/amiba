// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectorAccounts,
  ConnectView,
} from "@amiba/dsh-plugin-connector-core";
import {
  LarkPersonalService,
  PERSONAL_SCOPES,
  personalState,
  type LarkPersonalDeps,
} from "./personal.js";
import { createLarkResourceSource } from "./resources.js";
const now = 1_000_000;
const grant = (userId = "alice", expiresAt = now + 7200_000) => ({
  userId,
  name: userId,
  accessToken: `${userId}-token`,
  refreshToken: `${userId}-refresh`,
  expiresAt,
  refreshExpiresAt: now + 604800_000,
  scope: PERSONAL_SCOPES,
  generation: `${userId}-generation`,
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
        provider: "lark",
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
  const fetch = vi.fn<LarkPersonalDeps["fetch"]>();
  const personal = new LarkPersonalService(accounts, {
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
describe("personal authorization", () => {
  it("returns strictly JSON-safe status even before authorization", async () => {
    const h = fixture();
    const value = await h.personal.status("a");
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  });
  it("does not refresh credentials for a denied model request", async () => {
    const h = fixture({ a: { user: grant("alice", now), modelAccess: false } });
    await expect(
      h.personal.withUser("a", [], true, async () => "no"),
    ).rejects.toThrow("agent_access_disabled");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("never projects credentials and defaults agent access off", async () => {
    const h = fixture({ a: { user: grant() } });
    const status = await h.personal.status("a");
    expect(status.modelAccess).toBe(false);
    expect(status.access.label).toBe("alice");
    expect(JSON.stringify(status)).not.toMatch(/token|secret|refresh/);
    await expect(
      h.personal.withUser("a", [], true, async () => "x"),
    ).rejects.toThrow("agent_access_disabled");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("checks granted scopes and does not fall back to another account", async () => {
    const h = fixture({
      a: { user: { ...grant(), scope: [] } },
      b: { user: grant("bob"), modelAccess: true },
    });
    await expect(
      h.personal.withUser("a", [PERSONAL_SCOPES[0]!], false, async () => "x"),
    ).rejects.toThrow("permission_required");
    await expect(
      h.personal.withUser("missing", [], false, async () => "x"),
    ).rejects.toThrow("connection_unavailable");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("deduplicates refresh and preserves the other account", async () => {
    const h = fixture({
      a: { user: grant("alice", now), modelAccess: true },
      b: { user: grant("bob") },
    });
    h.fetch.mockResolvedValue(
      json({
        access_token: "new-token",
        refresh_token: "rotated",
        expires_in: 7200,
      }),
    );
    const reads = await Promise.all(
      [1, 2].map(() => h.personal.withUser("a", [], true, async () => "ok")),
    );
    expect(reads).toEqual(["ok", "ok"]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const init = h.fetch.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "alice-refresh",
    });
    expect(personalState(h.states.get("a")).user?.refreshToken).toBe("rotated");
    expect(personalState(h.states.get("b")).user?.accessToken).toBe(
      "bob-token",
    );
  });
  it("completes device authorization and keeps model consent off", async () => {
    const h = fixture();
    h.fetch
      .mockResolvedValueOnce(
        json({
          device_code: "private-device-code",
          user_code: "ABCD",
          verification_uri_complete:
            "https://accounts.feishu.cn/device?code=ABCD",
          expires_in: 240,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "new-token",
          refresh_token: "new-refresh",
          scope: PERSONAL_SCOPES.join(" "),
        }),
      )
      .mockResolvedValueOnce(
        json({ code: 0, data: { open_id: "alice", name: "Alice" } }),
      );
    const flow = await h.personal.begin("a");
    expect(JSON.stringify(flow)).not.toContain("private-device-code");
    await h.personal.poll("a", flow.id);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.advance(5000);
    expect((await h.personal.poll("a", flow.id)).state).toBe("completed");
    expect((await h.personal.status("a")).modelAccess).toBe(false);
    expect(personalState(h.states.get("b")).user).toBeUndefined();
  });
  it("cancels a flow and rejects cross-account poll", async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(
      json({
        device_code: "secret",
        verification_uri: "https://accounts.feishu.cn/device",
      }),
    );
    const flow = await h.personal.begin("a");
    await expect(h.personal.poll("b", flow.id)).rejects.toThrow("not_found");
    await h.personal.cancel("a", flow.id);
    await expect(h.personal.poll("a", flow.id)).rejects.toThrow("not_found");
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects an untrusted authorization destination", async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(
      json({
        device_code: "secret",
        verification_uri: "https://evil.example/device",
      }),
    );
    await expect(h.personal.begin("a")).rejects.toThrow(
      "invalid_authorization_url",
    );
  });
  it("removes only this account’s local personal grant", async () => {
    const h = fixture({
      a: { user: grant(), modelAccess: true },
      b: { user: grant("bob") },
    });
    await h.personal.disconnect("a");
    expect(personalState(h.states.get("a"))).toEqual({ modelAccess: false });
    expect(personalState(h.states.get("b")).user?.userId).toBe("bob");
  });
  it("sanitizes malformed credential-bearing upstream responses", async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(new Response("secret-token-not-json"));
    await expect(h.personal.begin("a")).rejects.toThrow(
      "invalid_lark_response",
    );
  });
});
describe("Lark resources", () => {
  it("keeps same-name people separate across accounts and signed user identities", async () => {
    const h = fixture({ a: { user: grant() }, b: { user: grant("bob") } });
    h.fetch.mockImplementation(async () =>
      json({
        code: 0,
        data: {
          items: [
            {
              id: "same-person-id",
              meta_data: { i18n_names: { zh_cn: "张三" } },
            },
          ],
        },
      }),
    );
    const result = await createLarkResourceSource(h.personal).search(
      { query: "张三", kind: "contact" },
      "preview",
      new AbortController().signal,
    );
    expect(
      result.items.map((item) => [item.ref.connectionId, item.ref.identity]),
    ).toEqual([
      ["a", "alice"],
      ["b", "bob"],
    ]);
    expect(
      h.fetch.mock.calls.map(
        (call) => (call[1]!.headers as Record<string, string>).Authorization,
      ),
    ).toEqual(["Bearer alice-token", "Bearer bob-token"]);
  });
  it("old references fail after identity replacement without making a resource request", async () => {
    const h = fixture({ a: { user: grant("bob") } });
    await expect(
      createLarkResourceSource(h.personal).read(
        {
          source: "lark",
          connectionId: "a",
          identity: "alice",
          kind: "contact",
          id: "person",
        },
        "preview",
        new AbortController().signal,
      ),
    ).rejects.toThrow("resource_identity_changed");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("serializing a document verifies access without fetching its full body", async () => {
    const h = fixture({ a: { user: grant(), modelAccess: true } });
    h.fetch.mockResolvedValue(
      json({ code: 0, data: { document: { title: "Plan" } } }),
    );
    const doc = await createLarkResourceSource(h.personal).read(
      {
        source: "lark",
        connectionId: "a",
        identity: "alice",
        kind: "docx",
        id: "doc123",
      },
      "reference",
      new AbortController().signal,
    );
    expect(doc.text).toBe("");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(String(h.fetch.mock.calls[0]![0])).not.toContain("raw_content");
  });
  it("distinguishes permission failure from zero results", async () => {
    const h = fixture();
    const result = await createLarkResourceSource(h.personal).search(
      { query: "test" },
      "preview",
      new AbortController().signal,
    );
    expect(result.items).toEqual([]);
    expect(result.unavailable.length).toBeGreaterThan(0);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
