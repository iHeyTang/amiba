import { describe, expect, it } from "vitest";

import { DshApiClient, createDshPlatformAdapters } from "./index.js";

function rpcClient(
  resolve: (method: string, payload: unknown, call: number) => unknown,
  seen: Array<{ method: string; payload: unknown }>,
): DshApiClient {
  let call = 0;
  return new DshApiClient({
    baseUrl: "http://dsh.test",
    makeRpcId: () => `rpc-${++call}`,
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        rpcId: string;
        method: string;
        payload: unknown;
      };
      seen.push({ method: body.method, payload: body.payload });
      const result = resolve(body.method, body.payload, call);
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
    expect(seen).toEqual([{ method: "subagent.history", payload: {
      parentSessionId: "parent", childSessionId: "child", mode, beforeSeq: 20, maxMessages: 200,
    } }]);
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
    expect(seen.map(({ method }) => method)).toEqual(["subagent.history"]);
  });

  it("preserves ordinary session history transport when no catalog address is supplied", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const adapters = createDshPlatformAdapters(rpcClient(() => ({ events: [], hasMore: false }), seen));
    await adapters.agentSessions.history("root", { beforeSeq: 0, maxMessages: 10 });
    expect(seen).toEqual([{ method: "session.history", payload: { sessionId: "root", beforeSeq: 0, maxMessages: 10 } }]);
  });

  it("uses plugin-owned Typert Remotes for feature domains", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient(
      (method) =>
        ({
          "amibaAttachments/readForPrompt": {
            attachmentId: "att-1",
            name: "notes.txt",
            mime: "text/plain",
            size: 5,
            kind: "text",
            dataBase64: "aGVsbG8=",
          },
        })[method],
      seen,
    );
    const adapters = createDshPlatformAdapters(client);

    await adapters.agentAttachments.readForPrompt("att-1");

    expect(seen).toEqual([
      {
        method: "amibaAttachments/readForPrompt",
        payload: { args: { attachmentId: "att-1" } },
      },
    ]);
  });

  it("resumes persisted sessions through DSH before scoped Client calls", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient(
      (method) =>
        ({
          "session.list": {
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
          "session.create": { sessionId: "session-1", agentPreset: "standard" },
          "amibaCommands/list": [{ name: "help", description: "Show help" }],
        })[method],
      seen,
    );
    const adapters = createDshPlatformAdapters(client);

    await expect(adapters.agentCommands.list("session-1")).resolves.toEqual([
      { name: "help", description: "Show help" },
    ]);

    expect(
      seen.filter((entry) => entry.method === "session.create"),
    ).toHaveLength(1);
    expect(seen.at(-1)).toEqual({
      method: "amibaCommands/list",
      payload: { args: { sessionId: "session-1" } },
    });
  });

  it("derives permission choices from DSH settings and session projections", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient((method) => {
      if (method === "settings.describe") {
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
      if (method === "session.history") {
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
