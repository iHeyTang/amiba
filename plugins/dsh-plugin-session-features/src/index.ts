import { SessionSeq } from "@deepseek-ai/dsh-session/types";
import { sharedConversationBinding, SHARED_CONVERSATION_FEATURE, installSharedConversationAccess } from "./shared-conversation.js";
export * from "./shared-conversation.js";
import z from "@deepseek-ai/schemastery";
import { ConversationLifecycle } from "./conversations.js";
import { conversationHistoryTool } from "./conversation-tools.js";
export * from "./conversations.js";
export * from "./conversation-history.js";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-tools";

export interface FeatureBinding {
  sessionId: string;
  plugin: string;
  version: number;
}
export const FEATURE_EVENT = "amiba/session-feature";
declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "amiba/session-feature": FeatureBinding;
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaSessionFeatures: SessionFeatures;
    amibaConversations: ConversationLifecycle;
  }
}

/** Ignorable to the DSH storage reader, required by the Amiba runtime before
 * execution. Exact session identity prevents fork/subagent role inheritance. */
export function featureSeed(
  sessionId: string,
  plugin: string,
  version: number,
): SessionEvent[] {
  return [
    {
      type: FEATURE_EVENT,
      seq: SessionSeq(0),
      time: Date.now(),
      ignorable: true,
      data: { sessionId, plugin, version },
    },
  ];
}
export function requiredFeatures(session: {
  id: unknown;
  snapshotEvents(): readonly SessionEvent[];
}): FeatureBinding[] {
  const bindings = session.snapshotEvents().flatMap((event) => {
    if (event.type !== FEATURE_EVENT || event.data.sessionId !== session.id)
      return [];
    const binding = event.data;
    if (
      !binding.plugin ||
      !Number.isSafeInteger(binding.version) ||
      binding.version < 1
    )
      throw new Error("Invalid session feature binding");
    return [binding];
  });
  if (sharedConversationBinding(session) && !bindings.some(binding => binding.plugin === SHARED_CONVERSATION_FEATURE))
    bindings.push({ sessionId: String(session.id), plugin: SHARED_CONVERSATION_FEATURE, version: 1 });
  return bindings;
}

type Installer = {
  version: number;
  install(ctx: Context): void | (() => void | Promise<void>);
};
/** Only owns plugin setup callbacks. DSH owns agents, scopes, tools and logs. */
export class SessionFeatures {
  private readonly agents = new Set<Agent>();
  private readonly cleanups = new Map<
    Context,
    Map<Installer, () => void | Promise<void>>
  >();
  track(agent: Agent): void {
    this.agents.add(agent);
  }
  untrack(agent: Agent): void {
    this.agents.delete(agent);
  }
  private readonly providers = new Map<string, Installer>();
  private readonly installed = new WeakMap<Context, Map<string, Installer>>();
  register(plugin: string, provider: Installer): () => Promise<void> {
    if (this.providers.has(plugin))
      throw new Error(`Session feature already registered: ${plugin}`);
    this.providers.set(plugin, provider);
    return async () => {
      if (this.providers.get(plugin) !== provider) return;
      this.providers.delete(plugin);
      const affected = [...this.agents].filter((agent) =>
        requiredFeatures(agent.session).some(
          (binding) => binding.plugin === plugin,
        ),
      );
      for (const agent of affected)
        agent.cancel({ kind: "disposed" }, { keepInbox: true });
      await Promise.all(affected.map((agent) => agent.whenIdle()));
      for (const [ctx, cleanups] of this.cleanups) {
        const cleanup = cleanups.get(provider);
        if (cleanup) {
          await cleanup();
          cleanups.delete(provider);
        }
        if (!cleanups.size) this.cleanups.delete(ctx);
      }
    };
  }
  ensure(ctx: Context, bindings: readonly FeatureBinding[]): boolean {
    let installed = this.installed.get(ctx);
    if (!installed) {
      installed = new Map();
      this.installed.set(ctx, installed);
    }
    let changed = false;
    for (const binding of bindings) {
      const provider = this.providers.get(binding.plugin);
      if (!provider || provider.version !== binding.version)
        throw new Error(
          `Session requires ${binding.plugin} v${binding.version}; enable the compatible plugin before continuing.`,
        );
      const previous = installed.get(binding.plugin);
      if (previous === provider) continue;
      if (previous)
        throw new Error(
          `Session feature ${binding.plugin} changed; close this agent and resume it before continuing.`,
        );
      const cleanup = provider.install(ctx);
      if (cleanup) {
        let cleanups = this.cleanups.get(ctx);
        if (!cleanups) {
          cleanups = new Map();
          this.cleanups.set(ctx, cleanups);
          ctx.effect(
            () => () => {
              this.cleanups.delete(ctx);
            },
            "amiba-session-features.cleanup",
          );
        }
        cleanups.set(provider, cleanup);
      }
      installed.set(binding.plugin, provider);
      changed = true;
    }
    return changed;
  }
  assertReady(agent: Agent): void {
    for (const binding of requiredFeatures(agent.session)) {
      const provider = this.providers.get(binding.plugin);
      if (
        !provider ||
        provider.version !== binding.version ||
        this.installed.get(agent.ctx)?.get(binding.plugin) !== provider
      ) {
        throw new Error(
          `Session feature ${binding.plugin} v${binding.version} is unavailable; resume through its plugin.`,
        );
      }
    }
  }
}

export const name = "amiba-session-features";
export const inject = ["agents", "systemPrompt", "tools"];
export interface Config { root?: string }
export const Config: z<Config> = z.object({ root: z.string() });
export function apply(ctx: Context, config: Config = {}): void {
  if (config.root) {
    const lifecycle = new ConversationLifecycle(config.root);
    ctx.provide("amibaConversations", lifecycle);
    ctx.effect(() => ctx.tools.register(conversationHistoryTool(ctx, lifecycle)), "amiba-conversations.history");
  }
  const features = new SessionFeatures();
  ctx.provide("amibaSessionFeatures", features);
  ctx.effect(() => features.register(SHARED_CONVERSATION_FEATURE, { version: 1, install: installSharedConversationAccess }), "amiba-conversations.shared-access");
  // DSH dispatches this synchronously inside the publication transaction;
  // a thrown setup error rolls the new/resumed agent back before loop start.
  ctx.on("agent/created", ({ agent }) => {
    features.ensure(agent.ctx, requiredFeatures(agent.session));
    features.track(agent);
  });
  ctx.on("agent/disposed", ({ agent }) => features.untrack(agent));
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    if (context.agent) features.assertReady(context.agent);
    return next();
  });
  // A plugin can disappear after prompt assembly. Recheck at execution too.
  ctx.tools.guard((execution) => {
    if (!execution.agent) return;
    try {
      features.assertReady(execution.agent as Agent);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

export { readSessionHistory } from "./session-history.js";
