import type {} from "@deepseek-ai/dsh-settings";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

export const name = "amiba-onboarding";
export const inject = ["settings"];
export function apply(ctx: Context) {
  ctx.settings.register(
    "amiba-onboarding",
    z.object({
      completed: z.array(z.string()).default([]),
      skipped: z.array(z.string()).default([]),
      finished: z.boolean().default(false),
    }),
    { base: { completed: [], skipped: [], finished: false } },
  );
}
