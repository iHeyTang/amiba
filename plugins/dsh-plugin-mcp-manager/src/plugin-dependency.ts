import type { Context } from "@deepseek-ai/cordis";
import type { McpDependency, McpLease, McpOwner } from "./dependencies.js";
import type { McpRequirement } from "./access.js";
import type { McpBindingState } from "./dependency-binding.js";

type Activate = (ctx: Context, lease: McpLease) => void | Promise<void>;

/** Product-facing declaration: no credentials or connection IDs in plugin code.
 * The settings UI selects a connection and approves the displayed capabilities.
 */
export function useMcpRequirement(ctx: Context, owner: McpOwner, requirement: McpRequirement, activate: Activate) {
  return ctx.inject(["amibaMcpManager", "tools"], async scope => {
    const consumer = await scope.amibaMcpManager.access.register(owner, requirement);
    const feature = mountBoundFeature(scope, consumer.binding, activate, consumer.dispose, consumer.reportFeature);
    consumer.onRetry(feature.retry);
  });
}

/** Mount a plugin feature only while its selected MCP dependency is ready.
 * Cordis owns both the Manager injection and each feature generation. Plugins
 * register their feature resources with the supplied context's normal effects.
 */
export function useMcpDependency(
  ctx: Context,
  request: McpDependency,
  activate: Activate,
): ReturnType<Context["inject"]> {
  // Retain the account pin across Manager reloads, not just connection reloads.
  const selected = structuredClone(request);
  return ctx.inject(["amibaMcpManager", "tools"], (scope) => {
    const binding = scope.amibaMcpManager.dependencies.bind(selected);
    mountBoundFeature(scope, binding, async (featureCtx, lease) => {
      selected.identity ??= lease.identity;
      await activate(featureCtx, lease);
    }, () => binding.dispose());
  });
}

function mountBoundFeature(
  scope: Context,
  binding: { getState(): McpBindingState; subscribe(listener: () => void): () => void },
  activate: Activate,
  dispose: () => Promise<void>,
  report?: (lease: McpLease, state: "connecting" | "ready" | "error") => void,
) {
    let current: { lease: McpLease; active: boolean; dispose(): Promise<void> } | undefined;
    let pending = Promise.resolve();
    let stopped = false;
    const reconcile = async () => {
      const state = binding.getState();
      if (!stopped && state.state === "ready" && current?.lease === state.lease && current.active) return;
      if (current) {
        await current.dispose();
        current = undefined;
      }
      if (stopped || state.state !== "ready" || state.lease.signal.aborted) return;
      report?.(state.lease, "connecting");
      let failed = false;
      const feature = await scope.inject(["tools"], async (featureCtx: Context) => {
        try { await activate(featureCtx, state.lease); }
        catch {
          failed = true;
          scope.logger.error("MCP-dependent feature activation failed");
        }
      });
      current = { lease: state.lease, active: false, dispose: () => feature.dispose() };
      if (failed || stopped || state.lease.signal.aborted) {
        await current.dispose();
        current = undefined;
      }
      if (current) current.active = true;
      report?.(state.lease, failed ? "error" : "ready");
    };
    const refresh = () => {
      pending = pending.then(reconcile).catch(() => {
        const state = binding.getState();
        if (state.state === "ready") report?.(state.lease, "error");
        scope.logger.error("MCP-dependent feature activation or teardown failed");
      });
    };
    const unsubscribe = binding.subscribe(refresh);
    scope.effect(() => async () => {
      stopped = true;
      unsubscribe();
      await dispose();
      await pending;
      await current?.dispose();
      current = undefined;
    }, "amiba.mcp-dependency");
    refresh();
    return { retry: async () => { refresh(); await pending; } };
}
