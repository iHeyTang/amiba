import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { buildHermesRuntimeEnv, discoverHermes, hermesBinaryCandidates } =
  await import("../hermes-discovery.ts");

test("discovery validates locally and never calls the networked version path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-hermes-detect-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "hermes");
  await fs.writeFile(
    binary,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  sleep 30
  exit 1
fi
if [ "$1" = "--help" ]; then
  echo "Hermes Agent - test runtime"
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );

  const result = await discoverHermes({
    cachedBinary: binary,
    env: { PATH: "/usr/bin:/bin" },
    userHome: root,
    timeoutMs: 1000,
  });

  assert.deepEqual(result, { installed: true, binary });
});

test("a stale persisted path falls through to the supported install layout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-hermes-home-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, ".local", "bin", "hermes");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(
    binary,
    '#!/bin/sh\necho "Hermes Agent - local install"\n',
    { mode: 0o755 },
  );

  const result = await discoverHermes({
    cachedBinary: path.join(root, "old", "hermes"),
    env: { PATH: "/usr/bin:/bin" },
    userHome: root,
  });

  assert.deepEqual(result, { installed: true, binary });
});

test("GUI runtime PATH always contains Hermes-managed paths without duplicates", () => {
  const home = "/Users/tester";
  const env = buildHermesRuntimeEnv(
    { PATH: "/usr/bin:/bin:/usr/bin" },
    home,
    ["/custom/venv/bin"],
    "darwin",
  );
  const entries = env.PATH.split(":");

  assert.equal(entries[0], "/custom/venv/bin");
  assert.ok(entries.includes(path.join(home, ".local", "bin")));
  assert.ok(entries.includes(path.join(home, ".hermes", "bin")));
  assert.ok(entries.includes(path.join(home, ".hermes", "node", "bin")));
  assert.equal(entries.filter((entry) => entry === "/usr/bin").length, 1);
});

test("custom install directories are part of the same discovery ladder", () => {
  const candidates = hermesBinaryCandidates({
    env: {
      HERMES_INSTALL_DIR: "/opt/custom-hermes",
      PATH: "/usr/bin:/bin",
    },
    userHome: "/Users/tester",
    platform: "darwin",
  });

  assert.ok(candidates.includes("/opt/custom-hermes/venv/bin/hermes"));
});
