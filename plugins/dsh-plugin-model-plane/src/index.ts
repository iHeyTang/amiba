import type {} from "@deepseek-ai/dsh-settings";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { migrateLegacySettings } from "./migrate-legacy.js";
import { DshModelPlaneStore } from "./store.js";

export const name = "amiba-model-plane";
export const inject = ["settings"];
export interface Config {
  root: string;
}
export const Config: z<Config> = z.object({ root: z.string().required() });
const UiPreferences = z.object({
  hiddenProviders: z.array(z.string()).default([]),
  hiddenModels: z.dict(z.array(z.string())).default({}),
});
/** The host owns only optional UI preferences and one-time migration.
 * All provider, model, configuration and credential APIs belong to DSH. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const prefs = await migrateLegacySettings(
    ctx,
    new DshModelPlaneStore(config.root),
  );
  const ns = "amiba-model-ui";
  ctx.settings.register(ns, UiPreferences, {
    base: { hiddenProviders: [], hiddenModels: {} },
  });
  const descriptor = ctx.settings.describe().find((d) => d.ns === ns);
  if (
    descriptor &&
    !descriptor.user &&
    (prefs.hiddenProviders || prefs.hiddenModels)
  ) {
    await ctx.settings.mutate(
      ns,
      [
        {
          op: "set",
          path: ["hiddenProviders"],
          value: prefs.hiddenProviders ?? [],
        },
        { op: "set", path: ["hiddenModels"], value: prefs.hiddenModels ?? {} },
      ],
      descriptor.revision,
    );
  }
}
