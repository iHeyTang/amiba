import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Cable } from "lucide-react";
import type { ReactNode } from "react";

import { buildConnectAdapter, type ConnectAdapter } from "./adapter.js";
import { DshSettingsConnect } from "./DshSettingsConnect.js";
import { AMIBA_CONNECTORS_REMOTE } from "../remote.js";

export const name = "amiba-connector-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "connect";

type ConnectSectionProps = PropsRuntime<"settings.section"> & {
  adapter: ConnectAdapter;
};

/**
 * Thin registration wrapper. `PropsRuntime<"settings.section">` carries
 * framework-mandatory members (`close`, `useSessions`, `useWorkspaces`) that
 * only the real slot runtime supplies; Connect needs none of them, so this
 * wrapper exists only to satisfy `slots.register`'s prop contract and forward
 * the one prop `DshSettingsConnect` actually needs. Same split
 * `DshSettingsMessaging`/`MessagingSettings` uses in the messaging-core
 * sibling — `DshSettingsConnect` itself stays plainly typed so it can be
 * rendered directly in a unit test.
 */
function ConnectSettingsSection({ adapter }: ConnectSectionProps): ReactNode {
  return <DshSettingsConnect adapter={adapter} />;
}

/** Register connector-core's management surface from the plugin's Client half. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_CONNECTORS_REMOTE);
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
            inject: () => ({ adapter, navIcon: () => <Cable /> }),
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
  };
}
