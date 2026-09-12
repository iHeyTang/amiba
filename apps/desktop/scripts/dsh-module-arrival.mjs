import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";

// Use the installed browser loader, not an imitation of its arrival algorithm.
// Factories reproduce the exact external requests reported by Rollup; platform
// exports are seeds here, since this test targets package arrival rather than UI.
export async function verifyModuleArrival(clients, reports) {
  let registration;
  const code = await fs.readFile(new URL("../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js", import.meta.url), "utf8");
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: row => registration = row } } });
  const { ClientModuleSystem } = registration.factory(() => { throw new Error("bootstrap requested an external"); });
  const normalize = value => value.replace(/\/client$/, "");
  const byId = new Map(clients.map(pkg => [pkg.name, pkg]));
  const staticModules = {};
  for (const report of reports.values()) for (const request of report.imports) {
    if (!byId.has(normalize(request))) staticModules[request] = {};
  }
  const make = () => {
    const loader = new ClientModuleSystem({
      manifest: { modules: clients.map(pkg => ({ id: pkg.name, url: pkg.name, external: pkg.manifest.dsh.client.external ?? [] })) },
      staticModules,
      registrationTarget: { mode: "queue", pendingQueue: [] },
      bootstrapModule: { id: registration.id, exports: {} },
      async loadBundle(id) {
        await new Promise(resolve => setTimeout(resolve, 1));
        loader.register({ id, factory(require) {
          for (const request of reports.get(id + "/client").imports) require(request);
          return { id };
        } });
      },
    });
    return loader;
  };
  // Each consumer must work when NONE of its dependencies has been prefetched.
  for (const pkg of [...clients].reverse()) {
    const loader = make();
    assert.equal((await loader.import(pkg.name)).id, pkg.name);
  }
  const loader = make();
  await Promise.all([...clients].reverse().map(pkg => loader.import(pkg.name)));
}
