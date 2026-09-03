import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { StewardStore } from "./store.js";
import type { StewardTask } from "./types.js";

function task(id: string): StewardTask {
  return {
    id,
    title: id,
    sessionId: `session-${id}`,
    cwd: "/tmp",
    origin: "created",
    status: "idle",
    lastReportedSeq: -1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("StewardStore", () => {
  it("starts empty and persists mutations atomically", async () => {
    const store = new StewardStore(mkdtempSync(join(tmpdir(), "amiba-steward-")));
    expect(await store.read()).toEqual({ version: 1, tasks: [] });
    await store.mutate((state) => ({ ...state, stewardSessionId: "session-s" }));
    await store.mutate((state) => ({ ...state, tasks: [...state.tasks, task("a")] }));
    const reread = new StewardStore(store.path.replace(/\/state\.json$/u, ""));
    const state = await reread.read();
    expect(state.stewardSessionId).toBe("session-s");
    expect(state.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("serializes concurrent mutations in order", async () => {
    const store = new StewardStore(mkdtempSync(join(tmpdir(), "amiba-steward-")));
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        store.mutate((state) => ({ ...state, tasks: [...state.tasks, task(id)] })),
      ),
    );
    expect((await store.read()).tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the empty state on a corrupt file and warns once", async () => {
    const root = mkdtempSync(join(tmpdir(), "amiba-steward-"));
    writeFileSync(join(root, "state.json"), "{ not json");
    const warn = vi.fn();
    const store = new StewardStore(root, warn);
    expect(await store.read()).toEqual({ version: 1, tasks: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
