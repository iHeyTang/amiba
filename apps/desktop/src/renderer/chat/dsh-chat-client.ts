import {
  DshChatEngineClient,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import { getPlatform, resolveSessionCreationWorkspace } from "@amiba/app-runtime/platform";

/** Compose shared DSH chat with only optional native Desktop providers. */
export function createDesktopDshChatClient(
  dshClient: DshApiClient,
): DshChatEngineClient {
  return new DshChatEngineClient({
    client: dshClient,
    attachments: getPlatform().agentAttachments,
    resolveSession: payload => resolveSessionCreationWorkspace(payload.sessionId),
    selectModel: async (sessionId, selection, signal) => {
      if (signal.aborted) throw signal.reason;
      const models = getPlatform().agentModels;
      if (models) await models.select(sessionId, selection);
      else await dshClient.selectModel({ sessionId, ...selection }, signal);
    },
  });
}
