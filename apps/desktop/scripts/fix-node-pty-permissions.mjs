import { constants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("node-pty");
  const root = path.dirname(path.dirname(entry));
  const candidates = [
    path.join(
      root,
      "prebuilds",
      `${process.platform}-${os.arch()}`,
      "spawn-helper",
    ),
    path.join(root, "build", "Release", "spawn-helper"),
  ];
  let fixed = false;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      await chmod(candidate, 0o755);
      fixed = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!fixed) {
    throw new Error(
      `node-pty spawn-helper was not found for ${process.platform}-${os.arch()}`,
    );
  }
}
