import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "../conversation-remote.js";
function preparationError(cause?: unknown) {
  return new Error(document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "暂时无法打开对话，请稍后重试。你的消息仍保留在输入框中。"
    : "Couldn't open the conversation. Please try again; your message is still in the composer.", { cause });
}
export async function createConversationPreparer(ctx: ClientContext) {
  let prepare: ((sessionId: string) => Promise<string>) | undefined;
  await ctx.inject(["remote.amibaConversationEntry"], child => {
    prepare = async sessionId => {
      const result = await child.remote.amibaConversationEntry.prepareSubmit(sessionId);
      if (!result.ok) throw preparationError(result.error);
      return result.value;
    };
    return () => { prepare = undefined; };
  });
  return async (sessionId: string) => {
    if (!prepare) throw preparationError();
    return prepare(sessionId);
  };
}
