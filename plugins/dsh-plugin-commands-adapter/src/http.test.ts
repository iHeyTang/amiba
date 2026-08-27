import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyCommandsHttp } from "./http.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

function harness() {
  let route:
    | { handler(req: unknown, res: unknown): void | Promise<void> }
    | undefined;
  const agent = { session: { id: "session-a" } };
  const list = vi.fn(async () => [
    {
      name: "plan",
      description: "Enter plan mode",
      input: { hint: "[message]" },
    },
  ]);
  const execute = vi.fn(async () => ({
    commandId: "command-1",
    result: { kind: "success", text: "Plan mode enabled" },
  }));
  const ctx = {
    effect(setup: () => unknown) {
      setup();
      return () => undefined;
    },
    agents: { get: (id: string) => (id === "session-a" ? agent : undefined) },
    commands: { list, execute },
    webServer: {
      register(value: typeof route) {
        route = value;
        return () => undefined;
      },
    },
  };
  applyCommandsHttp(ctx as never, { apiToken: TOKEN });
  return { route: route!, list, execute, agent };
}

function request(
  url: string,
  token = TOKEN,
  method = "GET",
  body?: Record<string, unknown>,
) {
  return Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), {
    method,
    url,
    headers: {
      "x-amiba-plugin-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
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

describe("Amiba DSH command catalog route", () => {
  it("returns the exact session-scoped descriptors", async () => {
    const { route, list, agent } = harness();
    const res = response();
    await route.handler(
      request("/api/amiba/commands?sessionId=session-a"),
      res,
    );
    expect(list).toHaveBeenCalledWith(agent);
    expect(res.result()).toEqual({
      status: 200,
      body: {
        ok: true,
        value: [
          {
            name: "plan",
            description: "Enter plan mode",
            inputHint: "[message]",
          },
        ],
      },
    });
  });

  it("fails closed without authentication or a live session", async () => {
    const { route, list } = harness();
    const unauthorized = response();
    await route.handler(
      request("/api/amiba/commands?sessionId=session-a", "wrong"),
      unauthorized,
    );
    expect(unauthorized.result().status).toBe(401);
    const missing = response();
    await route.handler(
      request("/api/amiba/commands?sessionId=missing"),
      missing,
    );
    expect(missing.result().body.error).toBe("session_not_live");
    expect(list).not.toHaveBeenCalled();
  });

  it("executes a known command through DSH's scoped command runtime", async () => {
    const { route, execute, agent } = harness();
    const res = response();
    await route.handler(
      request("/api/amiba/commands", TOKEN, "POST", {
        sessionId: "session-a",
        line: "/plan investigate",
      }),
      res,
    );
    // DSH 0.1.1 inserted composer image attachments BEFORE the signal. This
    // route has no attachment channel, so it must pass an explicit empty list
    // rather than shifting the signal into the images position.
    expect(execute).toHaveBeenCalledWith(
      agent,
      "/plan investigate",
      [],
      expect.any(AbortSignal),
    );
    expect(res.result()).toEqual({
      status: 200,
      body: {
        ok: true,
        value: {
          commandId: "command-1",
          result: { kind: "success", text: "Plan mode enabled" },
        },
      },
    });
  });

  it("returns a null admission for unknown slash input", async () => {
    const { route, execute } = harness();
    execute.mockResolvedValueOnce(undefined as never);
    const res = response();
    await route.handler(
      request("/api/amiba/commands", TOKEN, "POST", {
        sessionId: "session-a",
        line: "/not-a-command",
      }),
      res,
    );
    expect(res.result()).toEqual({
      status: 200,
      body: { ok: true, value: null },
    });
  });
});
