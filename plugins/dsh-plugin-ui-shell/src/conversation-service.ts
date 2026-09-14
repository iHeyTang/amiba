import { prepareSubagentParent } from "./prepare-subagent-parent.js";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

export class ConversationEntryRemoteService extends TypertRemoteService {
  constructor(private readonly host: Context) { super(host, "amibaConversationEntry"); }
  @Remote
  async prepareSubmit(sessionId: string): Promise<string> {
    const lifecycle = this.host.reflect.get("amibaConversations") as { prepareSubmit(id: string): Promise<string> } | undefined;
    if (!lifecycle) throw new Error("conversation_service_unavailable");
    const target = await lifecycle.prepareSubmit(sessionId);
    await prepareSubagentParent(this.host, target);
    return target;
  }
}
