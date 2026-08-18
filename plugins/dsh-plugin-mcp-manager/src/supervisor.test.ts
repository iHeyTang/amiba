import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyMcpHttp, DshMcpPluginSupervisor } from "./supervisor.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

function runtimeHarness(failServer?: string) {
  const mounts: Array<Record<string, unknown>> = [];
  const disposed: string[] = [];
  const ctx = {
    plugin: vi.fn(async (_plugin: unknown, config: Record<string, unknown>) => {
      if (config.serverName === failServer) throw new Error("mount failed");
      mounts.push(config);
      return {
        async dispose() {
          disposed.push(String(config.serverName));
        },
      };
    }),
  };
  return { ctx, mounts, disposed };
}

function stdio(serverName: string, command = "node", enabled = true) {
  return {
    serverName,
    transport: "stdio",
    command,
    args: ["server.js"],
    env: { TOKEN: "secret" },
    enabled,
  };
}

function request(body: unknown, token = TOKEN, method = "POST") {
  const stream = Readable.from([JSON.stringify(body)]);
  return Object.assign(stream, {
    method,
    url: "/api/amiba/mcp/reload",
    headers: {
      "x-amiba-plugin-token": token,
      "content-type": "application/json",
    },
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

describe("Amiba dynamic DSH MCP supervisor", () => {
  it("mounts one official DSH MCP client fiber per enabled server", async () => {
    const { ctx, mounts, disposed } = runtimeHarness();
    const supervisor = new DshMcpPluginSupervisor(ctx as never);
    await expect(
      supervisor.reload([
        stdio("local"),
        {
          serverName: "remote",
          transport: "streamable-http",
          url: "https://mcp.example.test/path",
          headers: { authorization: "Bearer secret" },
          enabled: true,
        },
      ]),
    ).resolves.toEqual({ generation: 1, configured: ["local", "remote"] });
    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toMatchObject({
      transport: "stdio",
      serverName: "local",
      failOnStartupError: false,
    });
    await supervisor.dispose();
    expect(disposed.sort()).toEqual(["local", "remote"]);
  });

  it("retains unchanged clients and replaces only changed definitions", async () => {
    const { ctx, mounts, disposed } = runtimeHarness();
    const supervisor = new DshMcpPluginSupervisor(ctx as never);
    await supervisor.reload([stdio("local")]);
    await supervisor.reload([stdio("local")]);
    expect(mounts).toHaveLength(1);
    await supervisor.reload([stdio("local", "bun")]);
    expect(disposed).toEqual(["local"]);
    expect(mounts).toHaveLength(2);
  });

  it("restores the prior generation when a replacement cannot mount", async () => {
    const { ctx, mounts, disposed } = runtimeHarness("broken");
    const supervisor = new DshMcpPluginSupervisor(ctx as never);
    await supervisor.reload([stdio("stable")]);
    await expect(supervisor.reload([stdio("broken")])).rejects.toThrow(/mount failed/u);
    expect(disposed).toEqual(["stable"]);
    expect(mounts.filter((item) => item.serverName === "stable")).toHaveLength(2);
  });

  it("protects the management route with the per-process DSH plugin token", async () => {
    let route: { handler(req: unknown, res: unknown): Promise<void> } | undefined;
    const effects: Array<() => unknown> = [];
    const { ctx } = runtimeHarness();
    applyMcpHttp(
      {
        ...ctx,
        effect(setup: () => () => unknown) {
          effects.push(setup());
          return () => undefined;
        },
        webServer: {
          register(value: typeof route) {
            route = value;
            return () => undefined;
          },
        },
      } as never,
      { apiToken: TOKEN },
    );

    const denied = response();
    await route!.handler(request({ servers: [] }, "wrong"), denied);
    expect(denied.result()).toEqual({ status: 401, body: { ok: false, error: "unauthorized" } });

    const allowed = response();
    await route!.handler(request({ servers: [stdio("local")] }), allowed);
    expect(allowed.result()).toEqual({
      status: 200,
      body: { ok: true, generation: 1, configured: ["local"] },
    });
    await Promise.all(effects.map((dispose) => dispose()));
  });
});
