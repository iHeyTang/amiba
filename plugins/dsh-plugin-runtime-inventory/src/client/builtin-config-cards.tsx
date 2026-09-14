import {
  BashCardController,
  AgentLoopCardController,
  WebSearchCardController,
} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import {
  type CardActions,
  type BashCardState,
  type AgentLoopCardState,
  type WebSearchCardState,
} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import { PluginConfigCard } from "@amiba/ui/plugin/runtime-inventory";
import { usePluginT } from "@amiba/ui/plugin";

type Read<S> = (selector: (state: S) => S) => S;
function BashCard(props: CardActions & { useBashCard: Read<BashCardState> }) {
  const state = props.useBashCard((s) => s);
  const zh = usePluginT().language === "zh-CN";
  return (
    <PluginConfigCard
      {...props}
      title={zh ? "Shell 执行" : "Shell execution"}
      state={state}
      fields={[
        {
          name: "timeoutMs",
          label: zh ? "命令超时（毫秒）" : "Command timeout (ms)",
          ...state.timeoutMs,
        },
        {
          name: "maxOutputBytes",
          label: zh
            ? "每路输出上限（字节）"
            : "Output limit per stream (bytes)",
          ...state.maxOutputBytes,
        },
      ]}
    />
  );
}
function AgentLoopCard(
  props: CardActions & { useAgentLoopCard: Read<AgentLoopCardState> },
) {
  const state = props.useAgentLoopCard((s) => s);
  const zh = usePluginT().language === "zh-CN";
  return (
    <PluginConfigCard
      {...props}
      title={zh ? "Agent 执行" : "Agent execution"}
      state={state}
      fields={[
        {
          name: "maxParallelToolCalls",
          label: zh ? "最大并行工具调用数" : "Maximum parallel tool calls",
          ...state.maxParallelToolCalls,
        },
      ]}
    />
  );
}
function WebSearchCard(
  props: CardActions & { useWebSearchCard: Read<WebSearchCardState> },
) {
  const state = props.useWebSearchCard((s) => s);
  const zh = usePluginT().language === "zh-CN";
  return (
    <PluginConfigCard
      {...props}
      title={zh ? "DeepSeek 网页搜索" : "DeepSeek web search"}
      state={state}
      fields={[
        {
          name: "baseURL",
          label: zh ? "服务地址" : "Service URL",
          ...state.baseURL,
        },
        {
          name: "maxUses",
          label: zh ? "每次请求最大搜索次数" : "Maximum searches per request",
          ...state.maxUses,
        },
        {
          name: "apiKey",
          label: "API Key",
          ...state.apiKey,
          secret: true,
          disabled: !state.apiKeyWritable,
          hint: state.apiKeyConfigured
            ? zh
              ? "已配置。留空保留现有密钥。"
              : "Configured. Leave blank to keep the current key."
            : zh
              ? "尚未配置。"
              : "Not configured.",
        },
      ]}
    />
  );
}

/** The official controllers subscribe eagerly; tie those subscriptions to the plugin fiber. */
function ownedScope<T>(
  ctx: ClientContext,
  scope: SettingsScope<T>,
): SettingsScope<T> {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe(listener) {
      const off = scope.subscribe(listener);
      ctx.effect(() => off);
      return off;
    },
    set: (field, value) => scope.set(field, value),
    unset: (field) => scope.unset(field),
    mutate: ops => scope.mutate(ops),
  };
}
export function registerBuiltinConfigCards(ctx: ClientContext) {
  return ctx.inject(["slots", "settingsScope", "connection", "remote", "remote.credentials", "remote.session"], (c) => {
    const bash = new BashCardController(
      ownedScope(c, c.settingsScope.bind({ namespace: "shell" })),
    );
    const agent = new AgentLoopCardController(
      ownedScope(c, c.settingsScope.bind({ namespace: "agent-loop" })),
    );
    const search = new WebSearchCardController(
      ownedScope(c, c.settingsScope.bind({ namespace: "web-search-deepseek" })),
      c,
    );
    c.effect(() =>
      c.remote.$on("credentials/reference-updated", (ref) =>
        search.refreshCredential(ref),
      ),
    );
    c.slots.inject("settings.plugin.item", function* () {
      yield c.slots.register(
        {
          name: "settings.plugin.item",
          key: "shell",
          inject: () => bash.inject(),
        },
        BashCard,
      );
      yield c.slots.register(
        {
          name: "settings.plugin.item",
          key: "agent-loop",
          inject: () => agent.inject(),
        },
        AgentLoopCard,
      );
      yield c.slots.register(
        {
          name: "settings.plugin.item",
          key: "web-search-deepseek",
          inject: () => search.inject(),
        },
        WebSearchCard,
      );
    });
  });
}
