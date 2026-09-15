import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Wallet } from "lucide-react";
import { type ReactNode } from "react";

import { AMIBA_USAGE_REMOTE } from "../remote.js";
import { labels } from "./TokensTab.js";
import { UsagePage } from "./UsagePage.js";
import type { UsageListFn } from "./token-usage.js";
import type { ToolActivityReadFn } from "./tool-usage.js";

export const name = "amiba-usage-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "usage";

type UsageRemote = ClientContext["remote"]["amibaUsage"];

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

type UsageSectionProps = PropsRuntime<"settings.section"> & {
  list: UsageListFn;
  readToolActivity: ToolActivityReadFn;
};

/** Top-level Settings section: the Tokens/Tools usage views. No header
 *  actions — both tabs auto-refresh on mount, focus, and a 30 s
 *  interval, the same behavior the host `SETTINGS_PAGES` entry had. */
function UsageSettings({ list, readToolActivity }: UsageSectionProps): ReactNode {
  return <UsagePage list={list} readToolActivity={readToolActivity} />;
}

/** Register the "usage" Settings section from Usage's Client half. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_USAGE_REMOTE);
  // Mounting contributes `remote.amibaUsage`; Cordis still requires
  // consumers to declare that dynamically-created service before reading
  // it. Keeping the registration in a dependent fiber guarantees the
  // section disappears if the Remote face is ever retracted.
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaUsage"],
    (injectedCtx) => {
      const remote: UsageRemote = injectedCtx.remote.amibaUsage;
      const list: UsageListFn = async () => {
        const result = await remote.list();
        if (!result.ok) throw errorOf(result.error);
        return result.value;
      };
      const readToolActivity: ToolActivityReadFn = async (days) => {
        const result = await remote.readToolActivity(days);
        if (!result.ok) throw errorOf(result.error);
        return result.value;
      };
      const disposeSection = injectedCtx.slots.inject(
        "settings.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "settings.section",
              id: SECTION_ID,
              order: 500,
              label: () => labels().nav,
              inject: () => ({ list, readToolActivity, navIcon: () => <Wallet /> }),
            },
            UsageSettings,
          ),
      );
      return () => {
        disposeSection();
      };
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
