import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { createToolviews } from "./toolviews.js";
export const name = "amiba-browser-core-ui";
export const inject = ["slots", "sessions"];
export function apply(ctx: ClientContext) {
  const views = createToolviews(async (sessionId, attachmentId) => {
    const sessions = ctx.sessions as unknown as ISessions;
    const session = sessions.binding(
      sessionId as Parameters<ISessions["binding"]>[0],
    )?.session;
    if (!session) throw new Error("Unknown session");
    const result = await session.readAttachment(
      attachmentId as Parameters<typeof session.readAttachment>[0],
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      data: result.value.data,
      mediaType: result.value.attachment.mediaType,
    };
  });
  const disposers = views.map(({ key, component }) =>
    ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register({ name: "tool.call.toolview", key }, component),
    ),
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}
