import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
// Type-only: loads connector-core's `declare module "@deepseek-ai/cordis"`
// augmentation, which is what puts `amibaConnectWizards` on `Context`. This
// plugin imports no VALUE from connector-core's client half — the registry
// arrives through `ctx`, and the wizard body depends only on its `host` prop.
import type {} from "@amiba/dsh-plugin-connector-core/client";
import { MessageSquare } from "lucide-react";

import { LarkWizard } from "./LarkWizard.js";

export const name = "amiba-connector-lark-ui";
/**
 * Cordis-level sequencing: connector-core's client half provides
 * `amibaConnectWizards` via `ctx.reflect.provide` before it registers the
 * Connect settings section, so injecting the service here is what guarantees
 * this registration lands before anything can read the registry.
 */
export const inject = ["amibaConnectWizards"];

/** Registers the Lark/Feishu wizard body with connector-core's registry. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const dispose = ctx.amibaConnectWizards.register("lark", {
    component: LarkWizard,
    icon: <MessageSquare className="h-[18px] w-[18px]" />,
    tagline: "飞书 / Lark",
  });
  return () => dispose();
}
