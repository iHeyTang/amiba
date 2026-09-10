import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
// Type-only: loads connector-core's `declare module "@deepseek-ai/cordis"`
// augmentation, which is what puts `amibaConnectorUI` on `Context`. This
// plugin imports no VALUE from connector-core's client half — the registry
// arrives through `ctx`, and the wizard body depends only on its `host` prop.
import type {} from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkMark } from "./brand-mark.js";
import { DingtalkConnectorDetails } from "./DingtalkConnectorDetails.js";
import { DingtalkWizard } from "./DingtalkWizard.js";

export const name = "amiba-connector-dingtalk-ui";
/**
 * Cordis-level sequencing: connector-core's client half provides
 * `amibaConnectorUI` via `ctx.reflect.provide` before it registers the
 * Connect settings section, so injecting the service here is what guarantees
 * this registration lands before anything can read the registry.
 */
export const inject = ["amibaConnectorUI"];

/** Registers the DingTalk wizard body with connector-core's registry. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const dispose = ctx.amibaConnectorUI.register("dingtalk", {
    component: DingtalkWizard,
    details: DingtalkConnectorDetails,
    icon: <DingtalkMark size={22} />,
    // A one-liner about what the wizard DOES: the chooser card already
    // shows the provider's display name as its title.
    tagline: "填写机器人的 Client ID 与 Secret 接入钉钉",
  });
  return () => dispose();
}
