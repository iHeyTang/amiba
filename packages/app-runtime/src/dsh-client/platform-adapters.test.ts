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
  it("uses plugin-owned Typert Remotes for feature domains", async () => {
    const seen: Array<{ method: string; payload: unknown }> = [];
    const client = rpcClient(
      (method) =>
        ({
          "amibaMemory/list": { preset: "standard", targets: [] },
          "amibaSchedules/list": [],
          "amibaMessaging/list": {
            providers: [],
            channels: [],
            inboundEndpoint: "http://127.0.0.1:1/api/amiba/message-inbound",
          },
          "amibaMcp/list": { servers: [], toolsOnly: true },
          "amibaUsage/list": { records: [], failures: [] },
          "amibaModelPlane/snapshot": {
            revision: 1,
            providers: [],
            groups: [],
            credentials: {},
            failures: [],
          },
        })[method],
      seen,
    );
    const adapters = createDshPlatformAdapters(client);

    await adapters.agentMemory.list("standard");
    await adapters.agentSchedules.list("session-1");
    await adapters.agentMessages.list();
    await adapters.agentMcp.list();
    await adapters.agentUsage.list();
    await adapters.modelPlane.snapshot();

    expect(seen).toEqual([
      {
        method: "amibaMemory/list",
        payload: { args: { preset: "standard" } },
      },
      {
        method: "amibaSchedules/list",
        payload: { args: { sessionId: "session-1" } },
      },
      { method: "amibaMessaging/list", payload: { args: {} } },
      { method: "amibaMcp/list", payload: { args: {} } },
      { method: "amibaUsage/list", payload: { args: {} } },
      { method: "amibaModelPlane/snapshot", payload: { args: {} } },
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
          "amibaTools/list": {
            tools: [],
          },
        })[method],
      seen,
    );
    const adapters = createDshPlatformAdapters(client);

    await expect(adapters.agentCommands.list("session-1")).resolves.toEqual([
      { name: "help", description: "Show help" },
    ]);
    await expect(adapters.agentTools.list()).resolves.toEqual({ tools: [] });

    expect(
      seen.filter((entry) => entry.method === "session.create"),
    ).toHaveLength(1);
    expect(seen.at(-1)).toEqual({
      method: "amibaTools/list",
      payload: { args: {} },
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
