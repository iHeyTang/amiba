import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Cable } from "lucide-react";
import type { ReactNode } from "react";

import { buildConnectAdapter, type ConnectAdapter } from "./adapter.js";
import { DshSettingsConnect } from "./DshSettingsConnect.js";
import { loadAgentPresets, type PresetConnection } from "./presets.js";
import {
  createConnectWizardRegistry,
  type ConnectWizardRegistry,
  type PresetOption,
} from "./wizard-registry.js";
import { AMIBA_CONNECTORS_REMOTE } from "../remote.js";

export const name = "amiba-connector-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "connect";

/**
 * Client-side registry of provider wizards, provided as the
 * `amibaConnectWizards` Cordis service — mirrors ui-shell's `layout` service
 * augmentation exactly (`plugins/dsh-plugin-ui-shell/src/client/index.tsx`),
 * including using `ctx.reflect.provide` so plugins declaring `inject:
 * ["amibaConnectWizards"]` can register a provider wizard from their own
 * client half (Phase B).
 */
declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaConnectWizards: ConnectWizardRegistry;
  }
}

/**
 * The wizard contract, re-exported through this package's `./client` entry so
 * a provider plugin's own client half can type its wizard body against it
 * (`import type { ConnectWizardHost } from
 * "@amiba/dsh-plugin-connector-core/client"`). Type-only on purpose: nothing
 * of it survives into a provider's bundle, and a provider body still depends
 * on no runtime value from this package — only on the `host` prop it is
 * handed.
 */
export type { ConnectWizardHost, ConnectWizardEntry, ConnectWizardRegistry, PresetOption } from "./wizard-registry.js";
export type { ConnectWizardKit, BasicsFieldsProps } from "./wizard-kit.js";

type ConnectSectionProps = PropsRuntime<"settings.section"> & {
  adapter: ConnectAdapter;
  registry: ConnectWizardRegistry;
  loadPresets: () => Promise<PresetOption[]>;
};

/**
 * Thin registration wrapper. `PropsRuntime<"settings.section">` carries
 * framework-mandatory members (`close`, `useSessions`, `useWorkspaces`) that
 * only the real slot runtime supplies; Connect needs none of them, so this
 * wrapper exists only to satisfy `slots.register`'s prop contract and forward
 * the props `DshSettingsConnect` actually needs. Same split
 * `DshSettingsMessaging`/`MessagingSettings` uses in the messaging-core
 * sibling — `DshSettingsConnect` itself stays plainly typed so it can be
 * rendered directly in a unit test.
 */
function ConnectSettingsSection({
  adapter,
  registry,
  loadPresets,
}: ConnectSectionProps): ReactNode {
  return (
    <DshSettingsConnect
      adapter={adapter}
      loadPresets={loadPresets}
      registry={registry}
    />
  );
}

/** Register connector-core's management surface from the plugin's Client half. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_CONNECTORS_REMOTE);
  // Provided BEFORE the settings.section registration below so a provider
  // plugin's own client half — which will inject `["amibaConnectWizards"]`
  // to register its wizard (Phase B) — can never race the section that
  // reads from this same registry.
  const registry = createConnectWizardRegistry();
  const disposeRegistry = ctx.reflect.provide("amibaConnectWizards", registry);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaConnectors"],
    (injectedCtx) => {
      const adapter = buildConnectAdapter(injectedCtx.remote.amibaConnectors);
      return injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            order: 410,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "连接"
                : "Connect",
            inject: () => ({
              adapter,
              navIcon: () => <Cable />,
              registry,
              // `connection` is a client-root service present regardless of
              // this plugin's own `inject` declaration above (mirrors how
              // dsh-plugin-agent-preset's client/data.ts consumes it) — read
              // via `ctx.get` at call time instead of adding it to `export
              // const inject`.
              loadPresets: () =>
                loadAgentPresets(
                  ctx.get("connection") as unknown as PresetConnection,
                ),
            }),
          },
          ConnectSettingsSection,
        ),
      );
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
    await disposeRegistry();
  };
}
