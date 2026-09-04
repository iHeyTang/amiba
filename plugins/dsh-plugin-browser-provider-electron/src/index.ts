import type { Context } from "@deepseek-ai/cordis";
import type { BrowserProvider } from "@amiba/dsh-plugin-browser-core";
import type { AmibaRuntimeGatewayClient } from "@amiba/dsh-plugin-runtime-gateway";

export const name = "amiba-browser-provider-electron";
export const inject = ["amibaBrowser", "amibaRuntimeGateway"];

export function apply(ctx: Context): void {
  const runtime = ctx as Context & {
    amibaRuntimeGateway: AmibaRuntimeGatewayClient;
  };
  const provider: BrowserProvider = {
    id: "electron-visible",
    name: "Electron Visible Browser",
    priority: 100,
    // Forward the owning session so Electron main can put the tab in the
    // workbench of the session that asked for it — not the visible one.
    call: (operation, argumentsValue, signal, context) =>
      runtime.amibaRuntimeGateway.call(
        operation,
        argumentsValue,
        signal,
        context,
      ),
  };
  ctx.effect(
    () => ctx.amibaBrowser.registerProvider(provider),
    "amiba-browser-provider-electron",
  );
}
