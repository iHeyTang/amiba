import { LarkConversationSettings } from "./LarkConversationSettings.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
// Type-only: loads connector-core's `declare module "@deepseek-ai/cordis"`
// augmentation, which is what puts `amibaConnectorUI` on `Context`. This
// plugin imports no VALUE from connector-core's client half — the registry
// arrives through `ctx`, and the wizard body depends only on its `host` prop.
import type {} from "@amiba/dsh-plugin-connector-core/client";

import { LarkMark } from "./brand-mark.js";
import { LarkConnectorDetails } from "./LarkConnectorDetails.js";
import { LarkConnectFlow } from "./LarkConnectFlow.js";
import { LarkPersonalSettings } from "./LarkPersonalSettings.js";
import { AMIBA_LARK_PERSONAL_REMOTE } from "../personal-remote.js";

export const name = "amiba-connector-lark-ui";
/**
 * Cordis-level sequencing: connector-core's client half provides
 * `amibaConnectorUI` via `ctx.reflect.provide` before it registers the
 * Connect settings section, so injecting the service here is what guarantees
 * this registration lands before anything can read the registry.
 */
export const inject = ["amibaConnectorUI", "remote"];

/** Registers the Lark/Feishu wizard body with connector-core's registry. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const unmount = await ctx.remote.$mount(AMIBA_LARK_PERSONAL_REMOTE);
  const fiber = ctx.inject(["remote.amibaLarkPersonal"], (ready) => {
    ready.effect(() =>
      ctx.amibaConnectorUI.register("lark", {
        component: ({ host }) => (
          <LarkConnectFlow
            host={host}
            remote={ready.remote.amibaLarkPersonal}
          />
        ),
        settingsFirst: true,
        details: LarkConnectorDetails,
        settings: ({ host }) => (
          <>
            <LarkPersonalSettings
              key={host.connect.id}
              host={host}
              remote={ready.remote.amibaLarkPersonal}
            />
            <LarkConversationSettings host={host} />
          </>
        ),
        icon: <LarkMark size={22} />,
        // A one-liner about what the wizard DOES: the chooser card already
        // shows the provider's display name as its title.
        tagline: "扫码授权或填写应用凭证接入飞书机器人",
      }),
    );
  });
  return () => {
    void fiber.dispose().then(() => unmount());
  };
}
