import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyScheduleHttp } from "./http.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

function harness() {
  let route: { handler(req: unknown, res: unknown): Promise<void> } | undefined;
  const execute = vi.fn(
    async (args: unknown, context: { name?: string }) =>
      context.name === "schedule_list" ? [] : args,
  );
  const agent = { session: { id: "session-a" } };
  const ctx = {
    effect(setup: () => unknown) {
      setup();
      return () => undefined;
    },
    agents: { get: (id: string) => (id === "session-a" ? agent : undefined) },
    tools: { get: () => ({ execute }) },
    webServer: {
      register(value: typeof route) {
        route = value;
        return () => undefined;
      },
    },
  };
  applyScheduleHttp(ctx as never, { apiToken: TOKEN });
  return { route: route!, execute };
}

function request(
  method: string,
  url: string,
  body?: Record<string, unknown>,
  token = TOKEN,
) {
  const stream = Readable.from(body ? [JSON.stringify(body)] : []);
  return Object.assign(stream, {
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

describe("Amiba DSH schedule management route", () => {
  it("rejects callers without the per-process token", async () => {
    const { route, execute } = harness();
    const res = response();
    await route.handler(
      request(
        "GET",
        "/api/amiba/schedules?sessionId=session-a",
        undefined,
        "wrong",
      ),
      res,
    );
    expect(res.result()).toEqual({
      status: 401,
      body: { ok: false, error: "unauthorized" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("lists reminders through the exact agent-scoped DSH tool", async () => {
    const { route, execute } = harness();
    const res = response();
    await route.handler(
      request("GET", "/api/amiba/schedules?sessionId=session-a"),
      res,
    );
    expect(res.result().status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        name: "schedule_list",
        agent: expect.any(Object),
      }),
    );
  });

  it("maps host create fields onto the native Schedule argument names", async () => {
    const { route, execute } = harness();
    const res = response();
    await route.handler(
      request("POST", "/api/amiba/schedules", {
        sessionId: "session-a",
        prompt: "Prepare the report",
        everySeconds: 900,
      }),
      res,
    );
    expect(res.result().status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      { prompt: "Prepare the report", every_seconds: 900 },
      expect.objectContaining({ name: "schedule_create" }),
    );
  });

  it("deletes only by session-local schedule id", async () => {
    const { route, execute } = harness();
    const res = response();
    await route.handler(
      request("DELETE", "/api/amiba/schedules", {
        sessionId: "session-a",
        id: "schedule-3",
      }),
      res,
    );
    expect(res.result().status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      { id: "schedule-3" },
      expect.objectContaining({ name: "schedule_delete" }),
    );
  });
});
