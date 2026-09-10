import { PageContent, ScrollArea } from "@amiba/ui/plugin";
import { Server } from "lucide-react";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";

import { AMIBA_MCP_REMOTE } from "../remote.js";
import { DshMcpToolsTab, type McpToolsAdapter } from "./DshMcpToolsTab.js";
import { McpAccessPanel, type McpAccessAdapter } from "./McpAccessPanel.js";

export const name = "amiba-mcp-manager-ui";
export const inject = ["slots", "remote"];

type McpRemote = ClientContext["remote"]["amibaMcp"];
type McpPanelProps = PropsRuntime<"settings.section"> & {
  adapter: McpToolsAdapter;
};

function McpPanel({ adapter }: McpPanelProps): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent size="lg" bodyClassName="space-y-6">
          <DshMcpToolsTab adapter={adapter} />
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function ConnectionAccess({ configuration, adapter }: PropsRuntime<"amiba.connection.access"> & { adapter: McpAccessAdapter }) {
  return <McpAccessPanel adapter={adapter} configuration={configuration} />;
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MCP_REMOTE);
  const panelFiber = ctx.inject(
    ["slots", "remote.amibaMcp", "layout"],
    (injectedCtx) => {
      const remote: McpRemote = injectedCtx.remote.amibaMcp;
      const accessAdapter: McpAccessAdapter = {
        list: () => valueOf(remote.listAccess()),
        approve: (id, connectionId, approvalToken) => valueOf(remote.approveAccess(id, connectionId, approvalToken)),
        revoke: (id) => valueOf(remote.revokeAccess(id)),
        retry: (id) => valueOf(remote.retryAccess(id)),
        openConnections: () => injectedCtx.layout.openSettings("connect"),
      };
      const adapter: McpToolsAdapter = {
        list: () => valueOf(remote.list()),
        save: (input) => valueOf(remote.save(input)),
        remove: async (serverName) => {
          await valueOf(remote.removeServer(serverName));
        },
      };
      const connectionAccess = injectedCtx.slots.inject("amiba.connection.access", () =>
        injectedCtx.slots.register({ name: "amiba.connection.access", id: "mcp", order: 100,
          inject: () => ({ adapter: accessAdapter }) }, ConnectionAccess));
      const mcpSection = injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: "mcp",
            order: 110,
            label: () => "MCP",
            inject: () => ({ adapter, navIcon: () => <Server /> }),
          },
          McpPanel,
        ),
      );
      return () => { connectionAccess(); mcpSection(); };
    },
  );
  await panelFiber;
  return async () => {
    await panelFiber.dispose();
    await disposeRemote();
  };
}
