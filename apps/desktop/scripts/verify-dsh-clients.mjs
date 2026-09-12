// Compile the real client configurations without modifying the managed runtime.
import { verifyModuleArrival } from "./dsh-module-arrival.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { workspacePackages } from "./dsh-client-dependencies.mjs";
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptsDir, "../../..");
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-clients-"));
try {
  const packages = await workspacePackages(workspaceDir);
  const clients = [...packages.values()].filter(pkg => pkg.manifest.dsh?.client);
  const reports = new Map();
  for (const pkg of clients) {
    const outDir = path.join(stage, path.basename(pkg.directory));
    const reportPath = outDir + ".json";
    const start = performance.now();
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(scriptsDir, "build-dsh-client.mjs"), pkg.directory, outDir, reportPath], { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, pkg.name);
    const chunks = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.equal(chunks.length, 1, `${pkg.name}: relative CJS chunks are not loadable by DSH`);
    assert.equal(chunks[0].fileName, "client.js");
    const source = await fs.readFile(path.join(outDir, "client.js"), "utf8");
    assert.ok(source.includes("window.__ModuleLoader__.load("), `${pkg.name}: missing DSH factory`);
    const inputs = JSON.parse(await fs.readFile(path.join(outDir, ".client-inputs.json"), "utf8"));
    assert.equal(inputs.workspaceDir, await fs.realpath(workspaceDir));
    assert.ok(inputs.files.some(file => file.startsWith(pkg.directory + path.sep)), `${pkg.name}: no source dependencies`);
    reports.set(pkg.name + "/client", chunks[0]);
    console.log(`[clients:verify] ${pkg.name} ${Math.round(performance.now() - start)}ms`);
  }
  let bindings = 0;
  for (const [name, report] of reports) {
    for (const [dependency, imports] of Object.entries(report.importedBindings)) {
      if (!reports.has(dependency)) continue;
      for (const binding of imports) {
        if (binding === "*") continue;
        assert.ok(reports.get(dependency).exports.includes(binding), `${name}: ${dependency} does not export ${binding}`);
        bindings++;
      }
    }
  }
  await verifyModuleArrival(clients, reports);
  console.log("[clients:verify] cold consumer-first and concurrent arrival passed using the installed DSH browser loader");
  console.log(`[clients:verify] ${clients.length} client factories; ${bindings} cross-plugin bindings verified`);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
