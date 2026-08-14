import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { migrateLegacyPairingApprovals } = await import(
  "../managed-hermes-pairing-migration.ts"
);

test("managed home merges approvals and ignores pending state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-pairing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyHome = path.join(root, "legacy");
  const managedHome = path.join(root, "managed");
  const legacyPairing = path.join(legacyHome, "pairing");
  const managedPairing = path.join(managedHome, "pairing");
  await Promise.all([
    fs.mkdir(legacyPairing, { recursive: true }),
    fs.mkdir(managedPairing, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(legacyPairing, "feishu-approved.json"),
    JSON.stringify({ legacy: { approved_at: "old" }, shared: { name: "old" } }),
  );
  await fs.writeFile(
    path.join(legacyPairing, "feishu-pending.json"),
    JSON.stringify({ pending: {} }),
  );
  await fs.writeFile(
    path.join(managedPairing, "feishu-approved.json"),
    JSON.stringify({ shared: { name: "managed" } }),
  );

  assert.deepEqual(
    await migrateLegacyPairingApprovals(legacyHome, managedHome),
    { migratedPlatforms: ["feishu"], migratedUsers: 1, skipped: false },
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(managedPairing, "feishu-approved.json"),
        "utf8",
      ),
    ),
    { legacy: { approved_at: "old" }, shared: { name: "managed" } },
  );
  await assert.rejects(
    fs.access(path.join(managedPairing, "feishu-pending.json")),
  );
});
