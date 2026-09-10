import { describe, expect, it } from "vitest";
import { MediaRegistry } from "./registry.js";
import type { MediaProvider, MediaRequest } from "./contracts.js";
const provider: MediaProvider = {
  prepare: async (request) => request,
  id: "fixture",
  describe: async () => ({
    provider: "fixture",
    name: "Fixture",
    models: [
      {
        id: "video",
        name: "Video",
        protocols: ["native"],
        operations: ["video.generate"],
      },
    ],
    protocols: [
      {
        id: "native",
        operations: ["video.generate"],
        documentation: [],
        instructions: "",
      },
    ],
  }),
  generate: async () => ({ status: "succeeded", artifacts: [] }),
};
const request: MediaRequest = {
  model: "video",
  protocol: "native",
  operation: "video.generate",
  parameters: { exclusive: { movement: [1, 2] } },
};
describe("media registry", () => {
  it("preserves native exclusive parameters without schema whitelisting", async () => {
    const registry = new MediaRegistry();
    const before = structuredClone(request);
    await registry.validate(provider, request, new AbortController().signal);
    expect(request).toEqual(before);
  });
  it("rejects routes that the configured provider does not advertise", async () => {
    const registry = new MediaRegistry();
    await expect(
      registry.validate(
        provider,
        { ...request, operation: "image.generate" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("available media route");
    await expect(
      registry.validate(
        provider,
        { ...request, parameters: { model: "other" } },
        new AbortController().signal,
      ),
    ).rejects.toThrow("must match");
  });
  it("does not let stale disposal unregister a replacement", () => {
    const registry = new MediaRegistry();
    const dispose = registry.registerProvider(provider);
    expect(() => registry.registerProvider(provider)).toThrow();
    dispose();
    const replacement = { ...provider };
    registry.registerProvider(replacement);
    dispose();
    expect(registry.get("fixture")).toBe(replacement);
  });
});
