import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";

import { apply, inject, name } from "./index.js";

vi.mock("@deepseek-ai/dsh-typert-protocol", () => ({
  Remote: (_target: unknown, _key: unknown, descriptor: unknown) => descriptor,
  TypertRemoteService: class {},
}));

describe("plugin entry (index.ts)", () => {
  it("declares name and inject", () => {
    expect(name).toBe("amiba-connector-dingtalk");
    expect(inject).toEqual(["amibaConnectors"]);
  });

  it("registers createDingtalkProvider() via ctx.effect, wrapping the disposer", () => {
    const disposer = vi.fn();
    const registerProvider = vi.fn((_provider: unknown) => disposer);
    const effectCalls: Array<{ execute: () => unknown; label?: string }> = [];
    const ctx = {
      effect: vi.fn((execute: () => unknown, label?: string) => {
        effectCalls.push({ execute, label });
        return execute();
      }),
      amibaConnectors: { registerProvider, accounts: vi.fn(() => ({})) },
      inject: vi.fn(),
    } as unknown as Context;

    apply(ctx);

    expect(ctx.effect).toHaveBeenCalledTimes(2);
    expect(effectCalls[0]?.label).toBe("amiba-connector-dingtalk.provider");
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider.mock.calls[0]?.[0]).toMatchObject({
      id: "dingtalk",
    });
  });
});
