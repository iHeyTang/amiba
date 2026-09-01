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

  it("claimOwner appends the new sender to owners already present instead of replacing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-connector-store-"));
    roots.push(root);
    const store = new ConnectorStore(root);
    const connect = await store.create({
      provider: "fake",
      name: "Pre-owned",
      agentPreset: "restricted",
    });
    // A row can end up with owners already present while `pairing` is still
    // true (defense-in-depth scenario claimOwner must never wipe out).
    await store.update(connect.id, { owners: ["existing"], pairing: true });

    const result = await store.claimOwner(connect.id, "newcomer");

    expect(result.claimed).toBe(true);
    expect(result.connect.owners).toEqual(["existing", "newcomer"]);
    expect(result.connect.pairing).toBe(false);

    const reloaded = (await store.list()).find((row) => row.id === connect.id);
    expect(reloaded?.owners).toEqual(["existing", "newcomer"]);
  });
});
