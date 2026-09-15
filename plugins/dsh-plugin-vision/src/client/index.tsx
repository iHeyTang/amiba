import { VISION_REMOTE } from "../remote.js";
import { VisionSettings } from "./settings.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";

export const name = "amiba-vision-client";
export const inject = ["slots", "remote"];
export async function apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(VISION_REMOTE);
  const fiber = ctx.inject(["slots", "remote.amibaVisionUi"], (child) => {
    const settings = child.slots.inject("amiba.models.extension", () =>
      child.slots.register(
        {
          name: "amiba.models.extension",
          id: "vision",
          inject: () => ({ api: child.remote.amibaVisionUi }),
        },
        VisionSettings,
      ),
    );
    return () => {
      settings();
    };
  });
  await fiber;
  return async () => {
    await fiber.dispose();
    await unmount();
  };
}
