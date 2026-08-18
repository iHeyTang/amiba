import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DshModelPlaneStore } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DshModelPlaneStore", () => {
  it("serializes durable updates into a private DSH-owned registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-model-plane-"));
    roots.push(root);
    const store = new DshModelPlaneStore(root);

    await Promise.all([
      store.set({ providers: [{ id: "deepseek-official" }] }),
      store.set({ revision: 3 }),
    ]);

    expect(await store.get("providers")).toEqual({
      providers: [{ id: "deepseek-official" }],
    });
    expect(JSON.parse(await readFile(store.path, "utf8"))).toMatchObject({
      revision: 3,
      providers: [{ id: "deepseek-official" }],
    });
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });
});
