import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import { getHermesMemoryList } from "../hermes-memory";

describe("Hermes memory client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
    backplaneFetch.mockResolvedValue(
      Response.json({ ok: true, targets: [] }),
    );
  });

  it("reads memory from the selected profile", async () => {
    await getHermesMemoryList("researcher");

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/memories?profile=researcher",
      { method: "GET" },
    );
  });
});
