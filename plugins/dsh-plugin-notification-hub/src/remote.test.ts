import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { NOTIFICATION_REMOTE } from "./remote.js";

// Execute the published browser gateway/registry factories, including their
// actual reserved namespace methods. A mock $mount cannot catch this failure.
const runtime = new URL(
  "../../../packages/app-runtime/resources/dsh-runtime/app/",
  import.meta.url,
);
const requireRuntime = createRequire(new URL("package.json", runtime));
function browserModule(name: string) {
  let exported: any;
  const source = readFileSync(
    fileURLToPath(
      new URL(`node_modules/@deepseek-ai/${name}/lib/client.js`, runtime),
    ),
    "utf8",
  );
  new Function("window", source)({
    __ModuleLoader__: {
      load: ({ factory }: any) => {
        exported = factory(requireRuntime);
      },
    },
  });
  return exported;
}
const { Context } = requireRuntime("@deepseek-ai/cordis");
it("mounts every notification method through the real DSH client gateway and supports remount", async () => {
  const ctx = new Context();
  const call = vi.fn(async () => ({ ok: true, value: true }));
  ctx.provide("connection", { rpc: { call } });
  browserModule("dsh-typert-registry").apply(ctx);
  browserModule("dsh-api-gateway").apply(ctx);
  const conflicting = {
    ...NOTIFICATION_REMOTE,
    descriptors: NOTIFICATION_REMOTE.descriptors.map((d) =>
      d.method === "dismiss" ? { ...d, method: "remove" } : d,
    ),
  };
  await expect(ctx.remote.$mount(conflicting)).rejects.toThrow(
    '"amibaNotifications/remove" conflicts with its namespace service',
  );
  for (let i = 0; i < 2; i++) {
    const unmount = await ctx.remote.$mount(NOTIFICATION_REMOTE);
    for (const descriptor of NOTIFICATION_REMOTE.descriptors)
      expect(typeof ctx.remote.amibaNotifications[descriptor.method]).toBe(
        "function",
      );
    expect(
      (await ctx.remote.amibaNotifications.dismiss("notification-id")).ok,
    ).toBe(true);
    expect(call.mock.lastCall?.slice(0, 3)).toEqual([
      "/api",
      "amibaNotifications/dismiss",
      { args: { id: "notification-id" } },
    ]);
    await unmount();
  }
});
