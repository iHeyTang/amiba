import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { PET_REMOTE } from "./remote.js";

// Execute the published browser gateway/registry factories, including their
// actual reserved namespace methods. A mock $mount cannot catch this failure.
const runtime = new URL("../../../packages/app-runtime/resources/dsh-runtime/app/", import.meta.url);
const requireRuntime = createRequire(new URL("package.json", runtime));
function browserModule(name: string) {
  let exported: any;
  const source = readFileSync(fileURLToPath(new URL(`node_modules/@deepseek-ai/${name}/lib/client.js`, runtime)), "utf8");
  new Function("window", source)({ __ModuleLoader__: { load: ({ factory }: any) => { exported = factory(requireRuntime); } } });
  return exported;
}
const { Context } = requireRuntime("@deepseek-ai/cordis");
it("mounts every pet method through the real DSH client gateway and supports remount", async () => {
  const ctx = new Context();
  const call = vi.fn(async () => ({ ok: true, value: { version: 1, activeId: null, pets: [] } }));
  ctx.provide("connection", { rpc: { call } });
  browserModule("dsh-typert-registry").apply(ctx);
  browserModule("dsh-api-gateway").apply(ctx);
  const conflicting = {
    ...PET_REMOTE,
    descriptors: PET_REMOTE.descriptors.map((d) => d.method === "deletePet" ? { ...d, method: "remove" } : d),
  };
  await expect(ctx.remote.$mount(conflicting)).rejects.toThrow('"amibaPets/remove" conflicts with its namespace service');
  for (let i = 0; i < 2; i++) {
    const unmount = await ctx.remote.$mount(PET_REMOTE);
    for (const descriptor of PET_REMOTE.descriptors) expect(typeof ctx.remote.amibaPets[descriptor.method]).toBe("function");
    expect((await ctx.remote.amibaPets.deletePet("pet-id")).ok).toBe(true);
    expect(call.mock.lastCall?.slice(0, 3)).toEqual(["/api", "amibaPets/deletePet", { args: { id: "pet-id" } }]);
    await unmount();
  }
});
