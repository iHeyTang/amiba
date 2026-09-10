import type { Context } from "@deepseek-ai/cordis";
import type { McpConnectionDefinition, McpOwner, McpServiceDefinition } from "./dependencies.js";
import type { McpRequirement } from "./access.js";
import { useMcpRequirement } from "./plugin-dependency.js";
import type { DshMcpManager } from "./manager.js";

/** Provider declaration survives Manager late-load/reload through Cordis.
 * It publishes a connection, never an implicit permission or an eager process.
 */
export function provideMcpConnection(
  ctx: Context,
  owner: McpOwner,
  service: McpServiceDefinition,
  connection: McpConnectionDefinition,
  tools: McpRequirement["tools"],
) {
  owner = structuredClone(owner); service = structuredClone(service);
  connection = structuredClone(connection); tools = structuredClone(tools);
  let liveManager: DshMcpManager | undefined;
  const ordinaryOwner = { id: "ordinary-agents", name: "普通智能体" };
  const fiber = ctx.inject(["amibaMcpManager", "tools"], async scope => {
    const manager = scope.amibaMcpManager;
    const dependencies = scope.amibaMcpManager.dependencies;
    const releaseService = await dependencies.registerService(owner, service);
    scope.effect(() => releaseService, "amiba.mcp-provider-service");
    const releaseConnection = await dependencies.registerConnection(owner, connection);
    scope.effect(() => releaseConnection, "amiba.mcp-provider-connection");
    liveManager = manager;
    scope.effect(() => () => { if (liveManager === manager) liveManager = undefined; });
    await dependencies.renameConnection(owner.id, connection.id, connection.name);
    useMcpRequirement(scope, ordinaryOwner, {
      id: connection.id, name: `${service.name} · ${connection.name}`,
      serviceId: service.id, version: service.version, tools,
      audience: "ordinary-agents", connectionId: connection.id,
      sharing: service.shareable ? "shared" : "isolated",
    }, (featureCtx, lease) => { featureCtx.effect(() => lease.expose(featureCtx)); });
  });
  return {
    dispose: () => fiber.dispose(),
    async rename(name: string) {
      connection.name = name;
      const manager = liveManager;
      if (!manager) return;
      await manager.dependencies.renameConnection(owner.id, connection.id, name);
      await manager.access.renameConnection(connection.id, name);
      await manager.access.renameRequirement(ordinaryOwner, connection.id, `${service.name} · ${name}`);
    },
  };
}
