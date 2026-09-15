import { describe, expect, it } from "vitest";

import { DshApiClient, createDshPlatformAdapters } from "./index.js";

function rpcClient(
  resolve: (method: string, payload: unknown, call: number) => unknown,
  seen: Array<{ method: string; payload: unknown }>,
): DshApiClient {
  let call = 0;
  return new DshApiClient({
    baseUrl: "http://dsh.test",
    createWebSocket: () => {
      const listeners = new Map<string, Set<(event: Event) => void>>();
      const socket = {
        readyState: 0,
        addEventListener(type: string, listener: (event: Event) => void) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set) },
        removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener) },
        close() { socket.readyState = 3 },
        send(data: string) {
          const frame = JSON.parse(data);
          if (frame.type !== "open") return;
          seen.push({ method: frame.endpoint, payload: frame.payload });
          const value = resolve(frame.endpoint, frame.payload, call) as { events: unknown[]; hasMore: boolean; projections?: unknown } | Error;
          queueMicrotask(() => {
            const wire = value instanceof Error
              ? { type: "error", streamId: frame.streamId, error: { code: (value as Error & { code?: string }).code, message: value.message } }
              : { type: "item", streamId: frame.streamId, value: { type: "snapshot", cursor: 12, records: value.events, hasMore: value.hasMore, projections: value.projections } };
            for (const listener of listeners.get("message") ?? []) listener(new MessageEvent("message", { data: JSON.stringify(wire) }));
          });
        },
      };
      queueMicrotask(() => { socket.readyState = 1; for (const listener of listeners.get("open") ?? []) listener(new Event("open")) });
      return socket;
    },
    makeRpcId: () => `rpc-${++call}`,
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        rpcId: string;
        method: string;
        payload: unknown;
      };
      seen.push({ method: body.method, payload: body.payload });
      const resolved = resolve(body.method, body.payload, call);
      const result = body.method === "session/page" && !(resolved instanceof Error) ? { ...(resolved as object), records: (resolved as { events: unknown[] }).events } : resolved;
      return new Response(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result:
            result instanceof Error
              ? {
                  ok: false,
                  error: {
                    code:
                      (result as Error & { code?: string }).code ?? "failed",
                    message: result.message,
                  },
                }
              : { ok: true, value: result },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });
}

describe("createDshPlatformAdapters", () => {
  it.each(["one-shot", "continuable"] as const)("reads %s catalog history through its direct parent without activating an Agent", async (mode) => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const events = [{ event: { type: "turn/end", seq: 12, time: 1, data: {} }, view: { kind: "complete" } }];
    const client = rpcClient(() => ({ events, hasMore: true, projections: { asOfSeq: 12, values: { title: "Child" } } }), seen);
    const adapters = createDshPlatformAdapters(client);
    await expect(adapters.agentSessions.history("child", {
      subagent: { parentSessionId: "parent", childSessionId: "child", mode },
      beforeSeq: 20,
      maxMessages: 200,
    })).resolves.toEqual({ events, hasMore: true, projections: { title: "Child" } });
    expect(seen).toEqual([
      { method: "session/follow", payload: { args: { request: { address: { kind: "subagent", parentSessionId: "parent", childSessionId: "child", mode }, maxMessages: 200 } } } },
      { method: "session/page", payload: { args: { request: { address: { kind: "subagent", parentSessionId: "parent", childSessionId: "child", mode }, throughSeq: 12, beforeSeq: 20, maxMessages: 200 } } } },
    ]);
  });

  it("rejects a mismatched child address before issuing any RPC", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const adapters = createDshPlatformAdapters(rpcClient(() => ({}), seen));
    await expect(adapters.agentSessions.history("other", {
      subagent: { parentSessionId: "parent", childSessionId: "child", mode: "one-shot" },
    })).rejects.toThrow("does not match");
    expect(seen).toEqual([]);
  });

  it("keeps catalog errors instead of retrying through ordinary session history", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const adapters = createDshPlatformAdapters(rpcClient(() => Object.assign(new Error("Child unavailable"), { code: "session-not-found" }), seen));
    await expect(adapters.agentSessions.history("child", {
      subagent: { parentSessionId: "parent", childSessionId: "child", mode: "continuable" },
    })).rejects.toMatchObject({ code: "session-not-found" });
    expect(seen.map(({ method }) => method)).toEqual(["session/follow"]);
  });

  it("preserves ordinary session history transport when no catalog address is supplied", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const adapters = createDshPlatformAdapters(rpcClient(() => ({ events: [], hasMore: false }), seen));
    await adapters.agentSessions.history("root", { beforeSeq: 0, maxMessages: 10 });
    expect(seen).toEqual([
      { method: "session/follow", payload: { args: { request: { address: { kind: "session", sessionId: "root" }, maxMessages: 10 } } } },
      { method: "session/page", payload: { args: { request: { address: { kind: "session", sessionId: "root" }, throughSeq: 12, beforeSeq: 0, maxMessages: 10 } } } },
    ]);
  });

  it("resumes persisted sessions through DSH before scoped Client calls", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient(
      (method) =>
        ({
          "session/list": {
            items: [
              {
                sessionId: "session-1",
                updatedAt: 1,
                running: false,
                blank: false,
                cwd: "/workspace",
                agentPreset: "standard",
              },
            ],
          },
          "session/create": { sessionId: "session-1", agentPreset: "standard" },
          "amibaCommands/list": [{ name: "help", description: "Show help" }],
        })[method],
      seen,
    );
    const adapters = createDshPlatformAdapters(client);

    await expect(adapters.agentCommands.list("session-1")).resolves.toEqual([
      { name: "help", description: "Show help" },
    ]);

    expect(
      seen.filter((entry) => entry.method === "session/create"),
    ).toHaveLength(1);
    expect(seen.at(-1)).toEqual({
      method: "amibaCommands/list",
      payload: { args: { sessionId: "session-1" } },
    });
  });

  it("derives permission choices from DSH settings and session projections", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient((method) => {
      if (method === "settings/describe") {
        return {
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: "permission",
              value: { defaultPreset: "standard" },
              schema: {
                uid: 1,
                refs: {
                  "1": { dict: { defaultPreset: 2 } },
                  "2": { type: "union", list: [3, 4] },
                  "3": { type: "const", value: "standard" },
                  "4": { type: "const", value: "trusted" },
                },
              },
              applies: "live",
              secrets: [],
              revision: 7,
            },
          ],
        };
      }
      if (method === "session/follow") {
        return {
          events: [],
          hasMore: false,
          projections: {
            asOfSeq: 1,
            values: {
              permissions: {
                currentValue: "standard",
                options: [
                  { value: "standard", name: "Standard" },
                  { value: "trusted", name: "Trusted" },
                ],
              },
            },
          },
        };
      }
      return undefined;
    }, seen);
    const permissions = createDshPlatformAdapters(client).agentPermissions;

    await expect(permissions.getDefault()).resolves.toMatchObject({
      currentValue: "standard",
      revision: 7,
      scope: "default",
    });
    await expect(permissions.getSession("session-1")).resolves.toMatchObject({
      currentValue: "standard",
      scope: "session",
    });
  });
});
