import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyToolsHttp, toolInventory } from "./tools-http.js";
import { ToolProvenanceRegistry } from "./provenance.js";

vi.mock("./registration-source.js", async (original) => ({ ...await original<object>(), shippedEntries: () => new Map([["builtin", "fixture"]]) }));

const owner = { fiber: { uid: 1, name: "fixture" }, [Symbol.for("cordis.entry")]: { id: "builtin", options: { id: "builtin", name: "fixture" }, parent: { ctx: {} } } };

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

function harness() {
  let route:
    | { handler(req: unknown, res: unknown): void | Promise<void> }
    | undefined;
  const schemas = vi.fn((scope?: { agentPreset?: string }) =>
    scope
      ? [
          {
            name: scope.agentPreset === "code" ? "run_code" : "read_file",
            description: "Official tool",
            parameters: { type: "object", properties: {} },
          },
        ]
      : [
          {
            name: "memos_search",
            description: "Search durable memory",
            parameters: { type: "object", properties: {} },
          },
        ],
  );
  const definitions = new Map<string, object>();
  const ctx = {
    effect(setup: () => unknown) {
      setup();
      return () => undefined;
    },
    agentPresets: {
      list: vi
        .fn()
        .mockResolvedValue([
          { id: "standard", trust: "system" },
          { id: "code", trust: "system" },
          { id: "broken", broken: "invalid composition" },
        ]),
      standingKeyFor: vi.fn((id: string) =>
        Promise.resolve({ agentPreset: id }),
      ),
    },
    tools: { schemas, registrationContext: () => owner, get: (name: string, scope?: unknown) => {
      if (!scope && name !== "memos_search") return undefined;
      if (!definitions.has(name)) definitions.set(name, {});
      return definitions.get(name);
    } },
    webServer: {
      register(value: typeof route) {
        route = value;
        return () => undefined;
      },
    },
  };
  const provenance = new ToolProvenanceRegistry();
  provenance.register("memos_search", {
    kind: "dsh-plugin",
    id: "amiba-memory",
    name: "Amiba Memory",
    packageName: "@amiba/dsh-plugin-memory-memos",
    loadMode: "plugin",
    executionTarget: "dsh-runtime",
    dynamic: false,
  });
  applyToolsHttp(ctx as never, { apiToken: TOKEN }, provenance);
  return { route: route!, schemas, ctx };
}

function request(url: string, token = TOKEN, method = "GET") {
  return Object.assign(Readable.from([]), {
    method,
    url,
    headers: { "x-amiba-plugin-token": token },
  });
}

function response() {
  let status = 0;
  let body = "";
  return {
    writeHead(value: number) {
      status = value;
    },
    setHeader() {},
    end(value = "") {
      body += String(value);
    },
    result: () => ({ status, body: JSON.parse(body) }),
  };
}

describe("Amiba DSH tool inventory route", () => {
  it("rejects unauthenticated access", async () => {
    const { route, schemas } = harness();
    const res = response();
    await route.handler(request("/api/amiba/tools", "wrong"), res);
    expect(res.result().status).toBe(401);
    expect(schemas).not.toHaveBeenCalled();
  });

  it("returns the union of global and healthy preset tool registrations", async () => {
    const { route, schemas, ctx } = harness();
    const res = response();
    await route.handler(request("/api/amiba/tools"), res);
    expect(schemas).toHaveBeenCalledTimes(3);
    expect(ctx.agentPresets.standingKeyFor).toHaveBeenCalledTimes(2);
    expect(res.result().status).toBe(200);
    expect(
      res.result().body.value.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["memos_search", "read_file", "run_code"]);
    expect(res.result().body.value.tools[0].source).toMatchObject({
      kind: "dsh-plugin",
      id: "amiba-memory",
    });
  });

  it("ignores legacy session query parameters and never reads an agent", async () => {
    const { route, ctx } = harness();
    const res = response();
    await route.handler(request("/api/amiba/tools?sessionId=missing"), res);
    expect(res.result().status).toBe(200);
    expect(ctx).not.toHaveProperty("agents");
  });
});

it("keeps inherited globals once and preserves a same-name user override", async () => {
  const builtin = { name: "search", parameters: {} };
  const user = { name: "search", parameters: { description: "custom" } };
  const ctx = {
    tools: {
      get: (_name: string, scope?: string) => scope === "custom" ? user : builtin,
      registrationContext: () => owner,
      schemas: (scope?: string) => [scope === "custom" ? user : builtin],
    },
    agentPresets: {
      list: async () => [{ id: "official", trust: "system" }, { id: "custom", trust: "user" }],
      standingKeyFor: async (id: string) => id,
    },
  };
  const result = await toolInventory(ctx as never, new ToolProvenanceRegistry());
  expect(result.tools).toHaveLength(2);
  expect(result.tools.map(tool => tool.source.distribution).sort()).toEqual(["builtin", "user"]);
  expect(new Set(result.tools.map(tool => tool.id)).size).toBe(2);
});
