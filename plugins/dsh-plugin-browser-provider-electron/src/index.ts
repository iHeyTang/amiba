import type {} from "@amiba/dsh-plugin-runtime-gateway";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { BrowserProvider } from "@amiba/dsh-plugin-browser-core";

export const name = "amiba-browser-provider-electron";
export const inject = ["amibaBrowser", "amibaRuntimeGateway"];

export async function apply(ctx: Context): Promise<void> {
  const gateway = ctx.amibaRuntimeGateway;
  const instanceId = randomUUID();
  let lease: string | undefined;
  let disposed = false;
  let unregister: (() => void) | undefined;
  // Install cleanup before asynchronous startup, including unload during attach.
  ctx.effect(
    () => async () => {
      disposed = true;
      unregister?.();
      if (lease)
        await gateway.call(
          "amiba_native_detach",
          { lease },
          AbortSignal.timeout(10_000),
        );
    },
    "amiba-browser-provider-electron",
  );
  const attached = await gateway
    .call(
      "amiba_native_attach",
      {
        packageName: "@amiba/dsh-plugin-browser-provider-electron",
        instanceId,
      },
      AbortSignal.timeout(10_000),
    )
    .catch(async (error) => {
      // A lost acknowledgement can leave main holding a lease we never received.
      await gateway.call(
        "amiba_native_detach",
        {
          packageName: "@amiba/dsh-plugin-browser-provider-electron",
          instanceId,
        },
        AbortSignal.timeout(10_000),
      );
      throw error;
    });
  if (typeof attached !== "string" || !attached)
    throw new Error("Invalid native browser lease");
  lease = attached;
  if (disposed) {
    await gateway.call(
      "amiba_native_detach",
      { lease },
      AbortSignal.timeout(10_000),
    );
    return;
  }
  const provider: BrowserProvider = {
    id: "electron-visible",
    name: "Electron Visible Browser",
    priority: 100,
    call: (method, input, signal, context) =>
      gateway.call(
        "amiba_native_call",
        { lease, method, input },
        signal,
        context,
      ),
  };
  try {
    unregister = ctx.amibaBrowser.registerProvider(provider);
  } catch (error) {
    await gateway.call(
      "amiba_native_detach",
      { lease },
      AbortSignal.timeout(10_000),
    );
    throw error;
  }
}
