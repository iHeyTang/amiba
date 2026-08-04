import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import {
  getHermesProfiles,
  setActiveHermesProfile,
  updateHermesProfileSoul,
} from "../hermes-profiles";

describe("Hermes profiles client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
  });

  it("reads active and currently running profiles from Hermes", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        profiles: [{ name: "default" }],
        active: "researcher",
        current: "default",
      }),
    );

    const result = await getHermesProfiles();

    expect(result.active).toBe("researcher");
    expect(result.current).toBe("default");
    expect(backplaneFetch).toHaveBeenCalledWith("/hermes/profiles");
  });

  it("writes profile selection and SOUL through the backplane", async () => {
    backplaneFetch.mockResolvedValue(Response.json({ ok: true }));

    await setActiveHermesProfile("researcher");
    await updateHermesProfileSoul("researcher", "# Researcher");

    expect(backplaneFetch).toHaveBeenNthCalledWith(
      1,
      "/hermes/profiles/active",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "researcher" }),
      }),
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      2,
      "/hermes/profiles/researcher/soul",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ content: "# Researcher" }),
      }),
    );
  });
});
