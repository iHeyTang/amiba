import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { migrateLegacyCronJobs } = await import(
  "../managed-hermes-cron-migration.ts"
);

test("managed home imports cron definitions without replay state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-cron-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyHome = path.join(root, "legacy");
  const managedHome = path.join(root, "managed");
  await Promise.all([
    fs.mkdir(path.join(legacyHome, "cron"), { recursive: true }),
    fs.mkdir(path.join(managedHome, "cron"), { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(legacyHome, "cron", "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          id: "daily",
          name: "Daily report",
          enabled: true,
          schedule: { kind: "cron", expr: "0 9 * * *" },
          next_run_at: "2020-01-01T09:00:00+08:00",
          fire_claim: { token: "stale" },
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(managedHome, "cron", "jobs.json"),
    JSON.stringify({ jobs: [{ id: "existing", name: "Keep me" }] }),
  );

  assert.deepEqual(await migrateLegacyCronJobs(legacyHome, managedHome), {
    migratedJobIds: ["daily"],
    skipped: false,
  });
  const migrated = JSON.parse(
    await fs.readFile(path.join(managedHome, "cron", "jobs.json"), "utf8"),
  );
  assert.deepEqual(
    migrated.jobs.map((job) => job.id),
    ["existing", "daily"],
  );
  assert.equal(migrated.jobs[1].next_run_at, undefined);
  assert.equal(migrated.jobs[1].fire_claim, undefined);
  assert.deepEqual(await migrateLegacyCronJobs(legacyHome, managedHome), {
    migratedJobIds: [],
    skipped: true,
  });
});
