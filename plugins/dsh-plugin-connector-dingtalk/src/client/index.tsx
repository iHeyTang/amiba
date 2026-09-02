import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
// Type-only: loads connector-core's `declare module "@deepseek-ai/cordis"`
// augmentation, which is what puts `amibaConnectWizards` on `Context`. This
// plugin imports no VALUE from connector-core's client half — the registry
// arrives through `ctx`, and the wizard body depends only on its `host` prop.
import type {} from "@amiba/dsh-plugin-connector-core/client";
import { Bot } from "lucide-react";

import { DingtalkWizard } from "./DingtalkWizard.js";

export const name = "amiba-connector-dingtalk-ui";
/**
 * Cordis-level sequencing: connector-core's client half provides
 * `amibaConnectWizards` via `ctx.reflect.provide` before it registers the
 * Connect settings section, so injecting the service here is what guarantees
 * this registration lands before anything can read the registry.
 */
export const inject = ["amibaConnectWizards"];

/** Registers the DingTalk wizard body with connector-core's registry. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const dispose = ctx.amibaConnectWizards.register("dingtalk", {
    component: DingtalkWizard,
    icon: <Bot className="h-[18px] w-[18px]" />,
    tagline: "钉钉 / DingTalk",
  });
  return () => dispose();
}
