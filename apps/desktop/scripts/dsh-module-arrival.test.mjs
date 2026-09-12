import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyModuleArrival } from "./dsh-module-arrival.mjs";

test("inject alone does not cause package arrival; external fixes cold and concurrent import", async () => {
  const shell = { name: "@amiba/dsh-plugin-ui-shell", manifest: { dsh: { client: { external: [] } } } };
  const skills = { name: "@amiba/dsh-plugin-skills", manifest: { dsh: { client: { inject: [shell.name] } } } };
  const reports = new Map([
    [shell.name + "/client", { imports: [] }],
    [skills.name + "/client", { imports: [shell.name + "/client"] }],
  ]);
  await assert.rejects(verifyModuleArrival([shell, skills], reports), /missed the module table/);
  skills.manifest.dsh.client.external = [shell.name + "/client"];
  await verifyModuleArrival([shell, skills], reports);
});
