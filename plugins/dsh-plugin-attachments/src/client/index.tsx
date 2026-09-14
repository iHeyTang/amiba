import { applyFileUpload } from './file-upload.js';
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { TOOLVIEWS } from "./toolviews.js";
export const name = "amiba-attachments-ui";
export const inject = ["slots"];
export function apply(ctx: ClientContext) {
  applyFileUpload(ctx);
  const disposers = TOOLVIEWS.map(({ key, component }) =>
    ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register({ name: "tool.call.toolview", key }, component),
    ),
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}
