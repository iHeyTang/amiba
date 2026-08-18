import { describe, expect, it } from "vitest";

import { __testing } from "./index.js";

describe("dsh-plugin-browser-provider-cdp", () => {
  it("accepts loopback CDP and rejects remote endpoints by default", () => {
    expect(__testing.validateEndpoint("http://127.0.0.1:9222", false).port).toBe("9222");
    expect(() => __testing.validateEndpoint("http://example.com:9222", false)).toThrow(
      "allowRemote=true",
    );
    expect(__testing.validateEndpoint("wss://browser.example.test/token", true).protocol).toBe(
      "wss:",
    );
  });
});
