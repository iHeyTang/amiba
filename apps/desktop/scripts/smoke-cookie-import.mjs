import { createRequire } from "node:module";
import {
  mkdtemp,
  rm,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(import.meta.url);
const work = await mkdtemp(path.join(tmpdir(), "amiba-cookie-electron-"));
try {
  const outfile = path.join(work, "fixture.cjs");
  await createRequire(require.resolve("vite"))("esbuild").build({
    entryPoints: [
      path.join(root, "apps/desktop/scripts/fixtures/cookie-import-smoke.ts"),
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  await mkdir(path.join(root, "apps/desktop/out/browser-smoke"), {
    recursive: true,
  });
  await createRequire(require.resolve("vite"))("esbuild").build({
    entryPoints: [
      path.join(root, "apps/desktop/scripts/fixtures/cookie-import-ui.tsx"),
    ],
    outfile: path.join(work, "ui.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const assets = path.join(root, "apps/desktop/out/renderer/assets");
  const stylesheet = (await readdir(assets)).find((name) =>
    /^globals-.*\.css$/.test(name),
  );
  if (!stylesheet)
    throw new Error("Build the desktop first for the UI stylesheet");
  await writeFile(
    path.join(work, "style.css"),
    await readFile(path.join(assets, stylesheet)),
  );
  await writeFile(
    path.join(work, "ui.html"),
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>',
  );
  const child = spawn(require("electron"), [outfile], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      AMIBA_COOKIE_TEST_ROOT: work,
      AMIBA_COOKIE_TEST_OUTPUT: path.join(
        root,
        "apps/desktop/out/browser-smoke/cookie-result.json",
      ),
    },
    stdio: "inherit",
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (status !== 0) throw new Error(`Cookie smoke exited ${status}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
