import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectorStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("connector store", () => {
  it("creates connects in pairing mode and round-trips updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-connector-store-"));
    roots.push(root);
    const store = new ConnectorStore(root);
    const connect = await store.create({
      provider: "fake",
      name: "My fake connect",
      agentPreset: "restricted",
    });
    expect(connect.id).toMatch(/^connect-/u);
    expect(connect).toMatchObject({ enabled: true, pairing: true, owners: [] });

    await store.update(connect.id, {
      pairing: false,
      owners: ["alice"],
      channelId: "channel-1",
    });
    const reloaded = new ConnectorStore(root);
    expect((await reloaded.list())[0]).toMatchObject({
      pairing: false,
      owners: ["alice"],
      channelId: "channel-1",
      agentPreset: "restricted",
    });

    expect(await store.remove(connect.id)).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });
});
