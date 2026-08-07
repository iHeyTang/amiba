import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  deleteHermesPersonality,
  getHermesPersonalities,
  saveHermesPersonality,
  setSelectedHermesPersonality,
} from "../hermes-personalities";
import { invalidateHermesCompatibilityCache } from "../backplane-client";

describe("getHermesPersonalities", () => {
  beforeEach(() => {
    invalidateHermesCompatibilityCache();
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns personalities on success", async () => {
    const body = [
      { key: "helpful", builtin: true, preview: "You are a helpful" },
    ];
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(new Response(JSON.stringify(body)));
    const res = await getHermesPersonalities();
    expect(res.ok).toBe(true);
    expect(res.personalities[0].key).toBe("helpful");
  });

  it("returns ok=false on error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("x"));
    const res = await getHermesPersonalities();
    expect(res.ok).toBe(false);
    expect(res.personalities).toEqual([]);
  });

  it("writes and resets a personality inside the selected profile", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(Response.json({ ok: true, key: "fact-checker" }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          key: "fact-checker",
          reset: false,
          existed: true,
        }),
      );

    await saveHermesPersonality("researcher", {
      key: "fact-checker",
      name: "Fact checker",
      system_prompt: "Verify every important claim.",
      description: "Fact checks sources",
      tone: "direct",
      style: "evidence first",
    });
    await deleteHermesPersonality("researcher", "fact-checker");

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:19394/hermes/personalities/fact-checker?profile=researcher",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Fact checker",
          system_prompt: "Verify every important claim.",
          description: "Fact checks sources",
          tone: "direct",
          style: "evidence first",
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:19394/hermes/personalities/fact-checker?profile=researcher",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("renames a custom mode without losing its original key", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(Response.json({ ok: true, key: "fact-checker" }));

    await saveHermesPersonality(
      "researcher",
      {
        key: "fact-checker",
        name: "Fact checker",
        system_prompt: "Verify every important claim.",
        description: "",
        tone: "",
        style: "",
      },
      "reviewer",
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:19394/hermes/personalities/fact-checker?profile=researcher",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Fact checker",
          system_prompt: "Verify every important claim.",
          description: "",
          tone: "",
          style: "",
          previous_key: "reviewer",
        }),
      }),
    );
  });

  it("sets the profile default response mode", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(Response.json({ ok: true, key: "concise" }));

    await setSelectedHermesPersonality("researcher", "concise");

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:19394/hermes/personalities/active?profile=researcher",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ key: "concise" }),
      }),
    );
  });
});
