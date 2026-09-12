import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  PropsRuntime,
  PropsRenderSlots,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { AmibaDshPluginManagerBridge } from "@amiba/extension-sdk";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import {
  PluginInventoryTabs,
  type DshPluginInventoryAdapter,
} from "@amiba/ui/plugin/runtime-inventory";
import { Blocks } from "lucide-react";
import { Fragment, useSyncExternalStore, type ReactNode } from "react";

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
  promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

type InventorySectionProps = PropsRuntime<"settings.section"> &
  PropsRenderSlots<"settings.plugins.tab"> & {
    adapter: DshPluginInventoryAdapter;
    tabSource: {
      subscribe(listener: () => void): () => void;
      getSnapshot(): string;
      entries(): readonly { id: string; label: string }[];
    };
  };

function RuntimeInventorySection({
  adapter,
  tabSource,
  renderSlot,
}: InventorySectionProps): ReactNode {
  useSyncExternalStore(tabSource.subscribe, tabSource.getSnapshot);
  return (
    <PluginInventoryTabs
      adapter={adapter}
      tabs={tabSource.entries()}
      renderTab={(id) => renderSlot("settings.plugins.tab", {}, { only: id })}
    />
  );
}

function ConfigurablePluginCards({
  renderSlot,
  tabSource,
  namespaces,
}: PropsRenderSlots<"settings.plugin.item"> & {
  tabSource: InventorySectionProps["tabSource"];
  namespaces(): readonly string[];
}): ReactNode {
  useSyncExternalStore(tabSource.subscribe, tabSource.getSnapshot);
  return namespaces().map((ns) => (
    <Fragment key={ns}>
      {renderSlot("settings.plugin.item", {}, { entryKey: ns })}
    </Fragment>
  ));
}

export async function apply(ctx: ClientContext): Promise<void> {
  const sectionFiber = ctx.inject(
    ["slots", "remote.pluginInventory", "settingsScope"],
    (injectedCtx) => {
      const remote: InventoryRemote = injectedCtx.remote.pluginInventory;
      const describe = injectedCtx.settingsScope.describe();
      const namespaces = () => {
        const served = new Set(
          describe.getSnapshot().view?.namespaces.map((view) => view.ns) ?? [],
        );
        return injectedCtx.slots
          .entriesOfSlot("settings.plugin.item")
          .flatMap((entry) =>
            entry.options.key !== undefined && served.has(entry.options.key)
              ? [entry.options.key]
              : [],
          );
      };
      const tabSource: InventorySectionProps["tabSource"] = {
        getSnapshot: () =>
          JSON.stringify([
            injectedCtx.slots.getVersion("settings.plugins.tab"),
            injectedCtx.slots.getVersion("settings.plugin.item"),
            document.documentElement.lang,
            namespaces(),
          ]),
        subscribe: (listener) => {
          const dispose = injectedCtx.slots.subscribe(
            "settings.plugins.tab",
            listener,
          );
          const ensure = () => {
            if (injectedCtx.slots.entriesOfSlot("settings.plugin.item").length)
              void describe.ensure();
          };
          const disposeCards = injectedCtx.slots.subscribe(
            "settings.plugin.item",
            () => {
              ensure();
              listener();
            },
          );
          const disposeDescribe = describe.subscribe(listener);
          const observer = new MutationObserver(listener);
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["lang"],
          });
          ensure();
          return () => {
            dispose();
            disposeCards();
            disposeDescribe();
            observer.disconnect();
          };
        },
        entries: () =>
          injectedCtx.slots
            .entriesOfSlot("settings.plugins.tab")
            .filter(
              (entry) =>
                entry.component !== ConfigurablePluginCards ||
                namespaces().length > 0,
            )
            .slice()
            .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
            .map((entry) => ({
              id: entry.options.id!,
              label:
                typeof entry.options.label === "function"
                  ? entry.options.label()
                  : (entry.options.label ?? entry.options.id!),
            })),
      };
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
                remove: (packageName: string) => management.remove(packageName),
                update: (packageName: string) => management.update(packageName),
              },
            }
          : {}),
      };
      return injectedCtx.slots.inject("settings.section", function* () {
        yield injectedCtx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            order: 300,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "插件"
                : "Plugins",
            inject: () => ({ adapter, tabSource, navIcon: () => <Blocks /> }),
            children: {
              "settings.plugins.tab": { kind: "list", scope: "root" },
            },
          },
          RuntimeInventorySection,
        );
        yield injectedCtx.slots.register(
          {
            name: "settings.plugins.tab",
            id: "configurable",
            order: 0,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "配置"
                : "Configuration",
            inject: () => ({ tabSource, namespaces }),
            children: {
              "settings.plugin.item": { kind: "keyed", scope: "root" },
            },
          },
          ConfigurablePluginCards,
        );
      });
    },
  );
  await sectionFiber;
}
