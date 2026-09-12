import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("the real Vite build rejects an undeclared external before publishing", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-externals-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadata = fileURLToPath(new URL("../../../scripts/dsh-client-inputs.mjs", import.meta.url));
  await fs.writeFile(path.join(root, "client.ts"), 'export {useState} from "react"');
  await fs.writeFile(path.join(root, "vite.config.ts"), `import {clientInputs} from ${JSON.stringify(metadata)}; export default {plugins:[clientInputs()], build:{lib:{entry:"client.ts",formats:["cjs"],fileName:()=>"client.js"},rollupOptions:{external:["react"]}}}`);
  const manifest = { name: "@amiba/externals-fixture", dsh: { client: { inject: ["react"] } } };
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  const args = [fileURLToPath(new URL("./build-dsh-client.mjs", import.meta.url)), root, path.join(root, "out")];
  await assert.rejects(run(process.execPath, args), error => error.stderr.includes('missing from dsh.client.external'));
  await assert.rejects(fs.access(path.join(root, "out/client.js")), { code: "ENOENT" });
  manifest.dsh.client.external = ["react"];
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  await run(process.execPath, args);
  assert.match(await fs.readFile(path.join(root, "out/client.js"), "utf8"), /require\("react"\)/);
});
