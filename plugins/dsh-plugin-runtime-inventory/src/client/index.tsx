import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { AmibaDshPluginManagerBridge } from "@amiba/extension-sdk";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import {
  DshPluginInventoryView,
  type DshPluginInventoryAdapter,
} from "@amiba/ui/plugin/runtime-inventory";
import type { ReactNode } from "react";

export const name = "amiba-runtime-inventory-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "plugins";
type InventoryRemote = ClientContext["remote"]["pluginInventory"];

function nativePluginManager(): AmibaDshPluginManagerBridge | undefined {
  return (
    globalThis as typeof globalThis & {
      amiba?: { dshPlugins?: AmibaDshPluginManagerBridge };
    }
  ).amiba?.dshPlugins;
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(
  promise: Promise<
    { ok: true; value: T } | { ok: false; error: unknown }
  >,
): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

type InventorySectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: DshPluginInventoryAdapter;
};

function RuntimeInventorySection({
  adapter,
  headerActionsHost,
}: InventorySectionProps): ReactNode {
  return (
    <DshPluginInventoryView
      adapter={adapter}
      headerActionsHost={headerActionsHost}
    />
  );
}

export async function apply(ctx: ClientContext): Promise<void> {
  const sectionFiber = ctx.inject(
    ["slots", "remote.pluginInventory"],
    (injectedCtx) => {
      const remote: InventoryRemote = injectedCtx.remote.pluginInventory;
      const management = nativePluginManager();
      const adapter: DshPluginInventoryAdapter = {
        list: async () => {
          const snapshot = await valueOf(remote.list());
          return {
            entries: snapshot.entries.map((entry) => ({
              entryId: String(entry.entryId),
              moduleName: entry.moduleName,
              enabled: entry.enabled,
              fiberPhase: entry.fiberPhase,
            })),
          };
        },
        ...(management
          ? {
              management: {
                list: () => management.list(),
                installRegistry: (spec: string) =>
                  management.installRegistry(spec),
                installArchive: () => management.installArchive(),
                remove: (packageName: string) =>
                  management.remove(packageName),
                update: (packageName: string) =>
                  management.update(packageName),
              },
            }
          : {}),
      };
      return injectedCtx.slots.inject("amiba.settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.settings.section",
            id: SECTION_ID,
            order: 300,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "插件"
                : "Plugins",
            inject: () => ({ adapter }),
          },
          RuntimeInventorySection,
        ),
      );
    },
  );
  await sectionFiber;
}
