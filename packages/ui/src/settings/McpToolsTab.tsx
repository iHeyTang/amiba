import { DshMcpToolsTab } from "./DshMcpToolsTab";
import { getPlatform } from "@amiba/app-runtime/platform";

export function McpToolsTab(_props: { profileId?: string } = {}) {
  return <DshMcpToolsTab adapter={getPlatform().agentMcp!} />;
}
