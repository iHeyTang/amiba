import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyToolsHttp } from "./tools-http.js";
import { ToolProvenanceRegistry } from "./provenance.js";

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
            name: "memory_list",
            description: "List durable memory",
            parameters: { type: "object", properties: {} },
          },
        ],
  );
  const ctx = {
    effect(setup: () => unknown) {
      setup();
      return () => undefined;
    },
    agentPresets: {
      list: vi
        .fn()
        .mockResolvedValue([
          { id: "standard" },
          { id: "code" },
          { id: "broken", broken: "invalid composition" },
        ]),
      standingKeyFor: vi.fn((id: string) =>
        Promise.resolve({ agentPreset: id }),
      ),
    },
    tools: { schemas },
    webServer: {
      register(value: typeof route) {
        route = value;
        return () => undefined;
      },
    },
  };
  const provenance = new ToolProvenanceRegistry();
  provenance.register("memory_list", {
    kind: "dsh-plugin",
    id: "amiba-memory",
    name: "Amiba Memory",
    packageName: "@amiba/dsh-plugin-memory",
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
    ).toEqual(["memory_list", "read_file", "run_code"]);
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
