import { DingtalkConversationSettings } from "./DingtalkConversationSettings.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
// Type-only: loads connector-core's `declare module "@deepseek-ai/cordis"`
// augmentation, which is what puts `amibaConnectorUI` on `Context`. This
// plugin imports no VALUE from connector-core's client half — the registry
// arrives through `ctx`, and the wizard body depends only on its `host` prop.
import type {} from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkMark } from "./brand-mark.js";
import { DingtalkConnectorDetails } from "./DingtalkConnectorDetails.js";
import { DingtalkConnectFlow } from "./DingtalkConnectFlow.js";
import { DingtalkPersonalSettings } from "./DingtalkPersonalSettings.js";
import { AMIBA_DINGTALK_PERSONAL_REMOTE } from "../personal-remote.js";

export const name = "amiba-connector-dingtalk-ui";
/**
 * Cordis-level sequencing: connector-core's client half provides
 * `amibaConnectorUI` via `ctx.reflect.provide` before it registers the
 * Connect settings section, so injecting the service here is what guarantees
 * this registration lands before anything can read the registry.
 */
export const inject = ["amibaConnectorUI", "remote"];

/** Registers the DingTalk wizard body with connector-core's registry. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const unmount = await ctx.remote.$mount(AMIBA_DINGTALK_PERSONAL_REMOTE);
  const fiber = ctx.inject(["remote.amibaDingtalkPersonal"], (ready) => {
    ready.effect(() =>
      ctx.amibaConnectorUI.register("dingtalk", {
        component: ({ host }) => (
          <DingtalkConnectFlow
            host={host}
            remote={ready.remote.amibaDingtalkPersonal}
          />
        ),
        settingsFirst: true,
        details: DingtalkConnectorDetails,
        settings: ({ host }) => (
          <>
            <DingtalkPersonalSettings
              key={host.connect.id}
              host={host}
              remote={ready.remote.amibaDingtalkPersonal}
            />
            <DingtalkConversationSettings host={host} />
          </>
        ),
        icon: <DingtalkMark size={22} />,
        // A one-liner about what the wizard DOES: the chooser card already
        // shows the provider's display name as its title.
        tagline: "连接钉钉消息会话，并授权搜索和读取个人文档",
      }),
    );
  });
  return () => {
    void fiber.dispose().then(() => unmount());
  };
}
