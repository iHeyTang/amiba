import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { apply, webhookProvider } from "./index.js";

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

describe("Webhook message-channel DSH plugin", () => {
  it("registers and disposes both the provider and ingress route", async () => {
    let route:
      | { handler(req: unknown, res: unknown): Promise<void> }
      | undefined;
    const disposers: Array<() => void> = [];
    const unregisterProvider = vi.fn();
    const unregisterRoute = vi.fn();
    const acceptInbound = vi.fn(async () => ({
      accepted: true,
      duplicate: false,
      sessionId: "session-a",
    }));
    const registerProvider = vi.fn(() => unregisterProvider);
    const ctx = {
      amibaMessageCenter: { registerProvider, acceptInbound },
      webServer: {
        register(value: typeof route) {
          route = value;
          return unregisterRoute;
        },
      },
      effect(setup: () => () => void) {
        const dispose = setup();
        disposers.push(dispose);
        return dispose;
      },
    };
    apply(ctx as never);
    expect(registerProvider).toHaveBeenCalledWith(webhookProvider);

    const req = Object.assign(
      Readable.from([
        JSON.stringify({
          channelId: "channel-a",
          id: "event-a",
          text: "hello",
          sender: "github",
        }),
      ]),
      {
        method: "POST",
        url: "/api/amiba/message-inbound",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
      },
    );
    const res = response();
    await route!.handler(req, res);
    expect(acceptInbound).toHaveBeenCalledWith("channel-a", "secret", {
      id: "event-a",
      text: "hello",
      sender: "github",
    });
    expect(res.result()).toMatchObject({ status: 202, body: { ok: true } });

    for (const dispose of disposers.reverse()) dispose();
    expect(unregisterProvider).toHaveBeenCalledTimes(1);
    expect(unregisterRoute).toHaveBeenCalledTimes(1);
  });

  it("rejects insecure remote callbacks before channel creation", async () => {
    expect(() =>
      webhookProvider.validate?.({
        id: "channel-a",
        provider: "webhook",
        name: "Alerts",
        sessionId: "session-a",
        enabled: true,
        outboundUrl: "http://example.com/reply",
        allowedSenders: [],
        secretHash: "00",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }),
    ).toThrow("outbound_url_requires_https");
  });
});
