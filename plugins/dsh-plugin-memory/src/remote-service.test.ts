import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";

import { AmibaMemoryStore } from "./memory-store.js";
import { resolveMemoryPresets } from "./remote-service.js";

async function store() {
  const root = await mkdtemp(path.join(tmpdir(), "amiba-memory-"));
  return new AmibaMemoryStore(root);
}

describe("resolveMemoryPresets", () => {
  it("prefers the live engine roster, filtering broken presets", async () => {
    const list = vi.fn().mockResolvedValue([
      { id: "standard" },
      { id: "researcher" },
      { id: "ghost", broken: "invalid composition" },
    ]);
    const ctx = { agentPresets: { list } } as unknown as Context;
    expect(await resolveMemoryPresets(ctx, await store())).toEqual([
      "standard",
      "researcher",
    ]);
  });

  it("falls back to stored preset ids plus 'standard' when no engine roster is composed", async () => {
    const ctx = {} as Context;
    const memoryStore = await store();
    await memoryStore.store({
      preset: "researcher",
      target: "memory",
      text: "Use primary sources.",
    });
    expect(await resolveMemoryPresets(ctx, memoryStore)).toEqual([
      "researcher",
      "standard",
    ]);
  });

  it("falls back when the engine roster read throws", async () => {
    const list = vi.fn().mockRejectedValue(new Error("unreachable"));
    const ctx = { agentPresets: { list } } as unknown as Context;
    expect(await resolveMemoryPresets(ctx, await store())).toEqual([
      "standard",
    ]);
  });

  it("falls back when the engine roster reports no healthy presets", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([{ id: "ghost", broken: "invalid composition" }]);
    const ctx = { agentPresets: { list } } as unknown as Context;
    expect(await resolveMemoryPresets(ctx, await store())).toEqual([
      "standard",
    ]);
  });
});
