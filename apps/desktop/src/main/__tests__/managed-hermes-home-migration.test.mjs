import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { migrateLegacyMessagingEnvironment } = await import(
  "../managed-hermes-home-migration.ts"
);

test("managed home imports only missing legacy messaging settings once", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-messaging-env-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyHome = path.join(root, "legacy");
  const managedHome = path.join(root, "managed");
  await Promise.all([
    fs.mkdir(legacyHome, { recursive: true }),
    fs.mkdir(managedHome, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(legacyHome, ".env"),
    [
      "FEISHU_APP_ID=legacy-app",
      "FEISHU_APP_SECRET=legacy-secret",
      "WEIXIN_ACCOUNT_ID=wx-account",
      "WEIXIN_TOKEN=wx-token",
      "OPENROUTER_API_KEY=do-not-copy",
      "API_SERVER_KEY=do-not-copy",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(managedHome, ".env"),
    [
      "# managed",
      "FEISHU_APP_ID=obsolete-app",
      "FEISHU_APP_ID=managed-app",
      "OPENROUTER_API_KEY=keep-managed-provider",
      "",
    ].join("\n"),
  );

  const [first, concurrent] = await Promise.all([
    migrateLegacyMessagingEnvironment(legacyHome, managedHome),
    migrateLegacyMessagingEnvironment(legacyHome, managedHome),
  ]);
  assert.deepEqual(first, {
    migratedKeys: ["FEISHU_APP_SECRET", "WEIXIN_ACCOUNT_ID", "WEIXIN_TOKEN"],
    skipped: false,
  });
  assert.deepEqual(concurrent, first);
  const migrated = await fs.readFile(path.join(managedHome, ".env"), "utf8");
  assert.match(migrated, /FEISHU_APP_ID=managed-app/);
  assert.equal((migrated.match(/^FEISHU_APP_ID=/gm) ?? []).length, 1);
  assert.doesNotMatch(migrated, /FEISHU_APP_ID=obsolete-app/);
  assert.match(migrated, /FEISHU_APP_SECRET=legacy-secret/);
  assert.match(migrated, /WEIXIN_ACCOUNT_ID=wx-account/);
  assert.match(migrated, /WEIXIN_TOKEN=wx-token/);
  assert.doesNotMatch(migrated, /OPENROUTER_API_KEY=do-not-copy/);
  assert.doesNotMatch(migrated, /API_SERVER_KEY/);
  assert.match(migrated, /OPENROUTER_API_KEY=keep-managed-provider/);

  await fs.appendFile(path.join(legacyHome, ".env"), "WECOM_BOT_ID=late\n");
  assert.deepEqual(
    await migrateLegacyMessagingEnvironment(legacyHome, managedHome),
    { migratedKeys: [], skipped: true },
  );
  assert.doesNotMatch(
    await fs.readFile(path.join(managedHome, ".env"), "utf8"),
    /WECOM_BOT_ID/,
  );
});
