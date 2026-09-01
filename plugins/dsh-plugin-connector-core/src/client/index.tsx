import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { PageContent, usePluginT } from "@amiba/ui/plugin";
import { Cable } from "lucide-react";
import type { ReactNode } from "react";

import { buildConnectAdapter, type ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { AMIBA_CONNECTORS_REMOTE } from "../remote.js";

export const name = "amiba-connector-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "connect";

type ConnectSectionProps = PropsRuntime<"settings.section"> & {
  adapter: ConnectAdapter;
};

/**
 * Placeholder for the Connect settings section. Renders a single translated
 * line so the `settings.section` registration (icon, label, ordering) can be
 * verified end to end before the real management UI lands. Task 7 replaces
 * this component with `DshSettingsConnect` — the props type is already the
 * one that component needs, so that swap is a one-line change here.
 */
function ConnectSettingsPlaceholder(_props: ConnectSectionProps): ReactNode {
  const { t } = usePluginT(connectI18n);
  return (
    <PageContent>
      <p>{t("options.connect.dsh.placeholder")}</p>
    </PageContent>
  );
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
          ConnectSettingsPlaceholder,
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
