import type { AgentMcpAdapter } from "@amiba/app-runtime/platform";
import type {} from "@amiba/dsh-plugin-catalog/client";
import { McpToolsView } from "@amiba/ui/plugin/mcp";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";

import { AMIBA_MCP_REMOTE } from "../remote.js";

export const name = "amiba-mcp-manager-ui";
export const inject = ["slots", "remote"];

type McpRemote = ClientContext["remote"]["amibaMcp"];
type McpPanelProps = PropsRuntime<"amiba.tools.panel"> & {
  adapter: AgentMcpAdapter;
};

function McpPanel({ adapter }: McpPanelProps): ReactNode {
  return <McpToolsView adapter={adapter} />;
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
    ["slots", "remote.amibaMcp"],
    (injectedCtx) => {
      const remote: McpRemote = injectedCtx.remote.amibaMcp;
      const adapter: AgentMcpAdapter = {
        list: () => valueOf(remote.list()),
        save: (input) => valueOf(remote.save(input)),
        remove: async (serverName) => {
          await valueOf(remote.removeServer(serverName));
        },
      };
      return injectedCtx.slots.inject("amiba.tools.panel", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.tools.panel",
            id: "mcp",
            order: 100,
            inject: () => ({ adapter }),
          },
          McpPanel,
        ),
      );
    },
  );
  await panelFiber;
  return async () => {
    await panelFiber.dispose();
    await disposeRemote();
  };
}
