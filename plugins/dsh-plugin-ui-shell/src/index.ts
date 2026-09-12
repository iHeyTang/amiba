import { ConversationEntryRemoteService } from "./conversation-service.js";
import type { Context } from "@deepseek-ai/cordis";
import { applyMarkdownCapabilities } from "./markdown-capabilities.js";
export {
  withMarkdownCapability,
  type MarkdownRequirement,
} from "./markdown-capabilities.js";
export const name = "amiba-ui-shell";
/** Report client capabilities; native Skills providers decide what to expose. */
export function apply(ctx: Context): void {
  applyMarkdownCapabilities(ctx);
  new ConversationEntryRemoteService(ctx);
}
