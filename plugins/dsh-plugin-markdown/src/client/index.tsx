import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/extension-sdk";
import { defaultMarkdown } from "./defaults.js";
export const name = "amiba-markdown-ui";
export const inject = ["slots"];
export function apply(ctx: ClientContext) {
  return ctx.slots.inject("amiba.markdown.extension", () =>
    ctx.slots.register(
      {
        name: "amiba.markdown.extension",
        id: defaultMarkdown.id,
        order: defaultMarkdown.order,
        inject: () => ({ extension: defaultMarkdown }),
      },
      () => null,
    ),
  );
}
