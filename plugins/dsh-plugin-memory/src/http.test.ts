import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { applyMemoryHttp } from "./http.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz-1234567890";

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

describe("Memory plugin management route", () => {
  it("administers the plugin store and unwinds its route", async () => {
    let route:
      | { handler(req: unknown, res: unknown): Promise<void> }
      | undefined;
    let effectDisposer: (() => void) | undefined;
    const unregister = vi.fn();
    const read = vi.fn(async (preset: string) => ({ preset, targets: [] }));
    const reset = vi.fn(async () => ({ deletedIds: ["mem-1"] }));
    const ctx = {
      webServer: {
        register(value: typeof route) {
          route = value;
          return unregister;
        },
      },
      effect(setup: () => () => void) {
        effectDisposer = setup();
        return effectDisposer;
      },
    };
    applyMemoryHttp(ctx as never, { apiToken: TOKEN }, {
      read,
      reset,
    } as never);

    const listRequest = Object.assign(Readable.from([]), {
      method: "GET",
      url: "/api/amiba/memory?preset=standard",
      headers: { "x-amiba-plugin-token": TOKEN },
    });
    const listed = response();
    await route!.handler(listRequest, listed);
    expect(read).toHaveBeenCalledWith("standard");
    expect(listed.result()).toEqual({
      status: 200,
      body: { ok: true, value: { preset: "standard", targets: [] } },
    });

    const deleteRequest = Object.assign(
      Readable.from([JSON.stringify({ preset: "standard", target: "all" })]),
      {
        method: "DELETE",
        url: "/api/amiba/memory",
        headers: {
          "x-amiba-plugin-token": TOKEN,
          "content-type": "application/json",
        },
      },
    );
    const deleted = response();
    await route!.handler(deleteRequest, deleted);
    expect(reset).toHaveBeenCalledWith("standard", "all");
    expect(deleted.result().body.value).toEqual({ deletedIds: ["mem-1"] });

    effectDisposer?.();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
