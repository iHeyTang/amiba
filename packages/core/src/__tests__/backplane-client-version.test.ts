import { beforeEach, describe, expect, it, vi } from "vitest";

const storageGet = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@amiba/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: storageGet,
    },
  }),
}));

import {
  backplaneFetch,
  invalidateHermesCompatibilityCache,
} from "../backplane-client";

describe("backplane Hermes version gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageGet.mockClear();
    invalidateHermesCompatibilityCache();
  });

  it("rejects functional requests when Hermes is below the minimum", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ version: "0.16.9" }));

    await expect(backplaneFetch("/hermes/model/options")).rejects.toMatchObject({
      name: "HermesVersionCompatibilityError",
      code: "hermes_version_unsupported",
      installed: "0.16.9",
      required: "0.19.0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows requests after a successful compatibility check", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const response = await backplaneFetch("/hermes/model/options");

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps status and update available for diagnosis and upgrades", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true }));

    await backplaneFetch("/hermes/status");
    await backplaneFetch("/hermes/update", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
