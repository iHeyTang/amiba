import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

export const name = "amiba-onboarding";
export const inject = ["settings"];
export function apply(ctx: Context) {
  ctx.settings.register(
    settingsNamespace("amiba-onboarding"),
    z.object({
      completed: z.array(z.string()).default([]),
      skipped: z.array(z.string()).default([]),
      finished: z.boolean().default(false),
    }),
    { base: { completed: [], skipped: [], finished: false } },
  );
}
