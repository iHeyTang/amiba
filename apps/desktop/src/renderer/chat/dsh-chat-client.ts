import {
  DshChatEngineClient,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import { getPlatform } from "@amiba/app-runtime/platform";

/** Compose shared DSH chat with only optional native Desktop providers. */
export function createDesktopDshChatClient(
  dshClient: DshApiClient,
): DshChatEngineClient {
  return new DshChatEngineClient({
    client: dshClient,
    attachments: getPlatform().agentAttachments,
    resolveSession: async (payload) => {
      const platform = getPlatform();
      const cwd = await platform.workspaces?.getCurrent(payload.sessionId);
      if (!cwd) return {};
      const explicitlyBound = Object.hasOwn(
        (await platform.workspaces?.listBindings()) ?? {},
        payload.sessionId,
      );
      if (explicitlyBound && platform.agentWorkspaces) {
        const { workspace } = await platform.agentWorkspaces.create(cwd);
        return { workspaceId: workspace.workspaceId };
      }
      return { cwd };
    },
    selectModel: async (sessionId, selection, signal) => {
      if (signal.aborted) throw signal.reason;
      const models = getPlatform().agentModels;
      if (models) await models.select(sessionId, selection);
      else await dshClient.selectModel({ sessionId, ...selection }, signal);
    },
  });
}
