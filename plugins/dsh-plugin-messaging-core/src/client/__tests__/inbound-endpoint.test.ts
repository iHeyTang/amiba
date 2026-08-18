import { afterEach, describe, expect, it } from "vitest";

import { absoluteInboundEndpoint } from "../inbound-endpoint.js";

afterEach(() => {
  document.documentElement.removeAttribute("data-amiba-dsh-base-url");
});

describe("absoluteInboundEndpoint", () => {
  it("resolves a server-relative path against the published DSH base URL", () => {
    document.documentElement.setAttribute(
      "data-amiba-dsh-base-url",
      "http://127.0.0.1:4823",
    );
    expect(absoluteInboundEndpoint("/api/amiba/message-inbound")).toBe(
      "http://127.0.0.1:4823/api/amiba/message-inbound",
    );
  });

  it("falls back to the page origin when no base URL is published", () => {
    expect(absoluteInboundEndpoint("/api/amiba/message-inbound")).toBe(
      `${window.location.origin}/api/amiba/message-inbound`,
    );
  });

  it("passes through endpoints that are already absolute", () => {
    expect(absoluteInboundEndpoint("https://relay.example/inbound")).toBe(
      "https://relay.example/inbound",
    );
  });
});
