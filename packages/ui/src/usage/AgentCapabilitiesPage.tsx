import type { ToolActivitySource } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";

import { DshAgentCapabilitiesPage } from "./DshAgentCapabilitiesPage";

export function AgentCapabilitiesPage(props: {
  embedded?: boolean;
  profileId?: string;
  toolActivitySource?: ToolActivitySource;
}) {
  const platform = getPlatform();

  return (
    <DshAgentCapabilitiesPage
      adapter={platform.agentTools!}
      embedded={props.embedded}
    />
  );
}
