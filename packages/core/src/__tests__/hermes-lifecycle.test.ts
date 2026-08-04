import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import { getHermesStatus } from "../hermes-lifecycle";

describe("Hermes lifecycle compatibility", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
  });

  it("marks a runtime below Amiba's minimum as incompatible", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        version: "0.16.9",
        protocol_version: 1,
        gateway_running: true,
      }),
    );

    const result = await getHermesStatus();

    expect(result.ok).toBe(true);
    expect(result.version_compatible).toBe(false);
    expect(result.hermes_version_mismatch).toEqual({
      installed: "0.16.9",
      required: "0.19.0",
      reason: "unsupported",
    });
  });

  it("accepts a runtime at the minimum version", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        version: "0.19.0",
        protocol_version: 1,
        gateway_running: true,
      }),
    );

    const result = await getHermesStatus();

    expect(result.version_compatible).toBe(true);
    expect(result.hermes_version_mismatch).toBeUndefined();
  });
});
