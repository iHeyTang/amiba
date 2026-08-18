import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshAgentCapabilitiesPage`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host `en.ts` / `zh-CN.ts` bundles. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (`packages/i18n/src/en.ts` / `zh-CN.ts`). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 *
 * The `en` table is kept `as const` so `CatalogMessageKey` stays a literal
 * union — the capabilities page stores keys in typed lookup tables
 * (`SOURCES`, `LOAD_MODE_KEYS`, `EXECUTION_TARGET_KEYS`) that used to lean
 * on the host `MessageKey` union before these keys moved plugin-local.
 * Typing `zhCN` as `Record<CatalogMessageKey, string>` additionally makes
 * missing or extra zh-CN keys a compile error.
 */
const en = {
  "agentCapabilities.back": "Back to tools",
  "agentCapabilities.dsh.description":
    "Every tool registered in the DSH runtime, with its actual source.",
  "agentCapabilities.dsh.empty": "No tools are registered in this runtime.",
  "agentCapabilities.dsh.noDescription": "No tool description provided.",
  "agentCapabilities.dsh.ready": "Registered",
  "agentCapabilities.dsh.schema": "Input schema",
  "agentCapabilities.dsh.schema.description":
    "The JSON Schema DSH sends to the selected model for this tool.",
  "agentCapabilities.dsh.source.filter": "Filter by tool source",
  "agentCapabilities.dsh.source.all": "All",
  "agentCapabilities.dsh.source.empty": "This source has no available tools.",
  "agentCapabilities.dsh.source.dshCore": "Official DSH capabilities",
  "agentCapabilities.dsh.source.dshCore.description":
    "Registered by official plugins across the installed DSH presets.",
  "agentCapabilities.dsh.source.dshPlugin": "Amiba DSH Plugins",
  "agentCapabilities.dsh.source.dshPlugin.description":
    "Registered by independent dsh-plugin-* projects assembled by the Amiba bundle.",
  "agentCapabilities.dsh.source.mcpServer": "MCP Server",
  "agentCapabilities.dsh.source.mcpServer.description":
    "Provided by external services connected through the DSH MCP Client plugin.",
  "agentCapabilities.dsh.source.detail": "Tool source",
  "agentCapabilities.dsh.source.detail.description":
    "The actual registration path that contributes this tool to the DSH runtime.",
  "agentCapabilities.dsh.source.category": "Source type",
  "agentCapabilities.dsh.source.owner": "Owning plugin",
  "agentCapabilities.dsh.source.provider": "Capability provider",
  "agentCapabilities.dsh.source.package": "Implementation package",
  "agentCapabilities.dsh.source.identifier": "Source identifier",
  "agentCapabilities.dsh.source.loadMode": "Load mode",
  "agentCapabilities.dsh.source.executionTarget": "Execution target",
  "agentCapabilities.dsh.source.dynamic": "Dynamic mount",
  "agentCapabilities.dsh.source.bundled": "Loaded with runtime",
  "agentCapabilities.dsh.loadMode.core": "DSH Profile / Bundle",
  "agentCapabilities.dsh.loadMode.plugin": "Cordis Plugin",
  "agentCapabilities.dsh.loadMode.mcp": "MCP Client",
  "agentCapabilities.dsh.executionTarget.dshRuntime": "DSH Runtime",
  "agentCapabilities.dsh.executionTarget.desktopService":
    "Desktop platform service",
  "agentCapabilities.dsh.executionTarget.externalProcess":
    "External isolated process",
} as const;

export type CatalogMessageKey = keyof typeof en;

const zhCN: Record<CatalogMessageKey, string> = {
  "agentCapabilities.back": "返回工具",
  "agentCapabilities.dsh.description":
    "展示 DSH Runtime 中已注册的全部工具，并标明真实来源。",
  "agentCapabilities.dsh.empty": "当前运行时没有注册任何工具。",
  "agentCapabilities.dsh.noDescription": "这个工具没有提供说明。",
  "agentCapabilities.dsh.ready": "已注册",
  "agentCapabilities.dsh.schema": "输入 Schema",
  "agentCapabilities.dsh.schema.description":
    "DSH 针对此工具发送给所选模型的 JSON Schema。",
  "agentCapabilities.dsh.source.filter": "按工具来源筛选",
  "agentCapabilities.dsh.source.all": "全部",
  "agentCapabilities.dsh.source.empty": "这个来源当前没有可用工具。",
  "agentCapabilities.dsh.source.dshCore": "DSH 官方能力",
  "agentCapabilities.dsh.source.dshCore.description":
    "由已安装 DSH presets 中的官方插件注册。",
  "agentCapabilities.dsh.source.dshPlugin": "Amiba DSH Plugins",
  "agentCapabilities.dsh.source.dshPlugin.description":
    "由独立的 dsh-plugin-* 项目注册，并通过 Amiba bundle 组装。",
  "agentCapabilities.dsh.source.mcpServer": "MCP Server",
  "agentCapabilities.dsh.source.mcpServer.description":
    "由 DSH MCP Client 插件连接的外部服务提供。",
  "agentCapabilities.dsh.source.detail": "工具来源",
  "agentCapabilities.dsh.source.detail.description":
    "此工具进入 DSH Runtime 的真实注册路径。",
  "agentCapabilities.dsh.source.category": "来源类别",
  "agentCapabilities.dsh.source.owner": "所属插件",
  "agentCapabilities.dsh.source.provider": "能力提供者",
  "agentCapabilities.dsh.source.package": "实现包",
  "agentCapabilities.dsh.source.identifier": "来源标识",
  "agentCapabilities.dsh.source.loadMode": "加载方式",
  "agentCapabilities.dsh.source.executionTarget": "执行位置",
  "agentCapabilities.dsh.source.dynamic": "动态挂载",
  "agentCapabilities.dsh.source.bundled": "随运行时加载",
  "agentCapabilities.dsh.loadMode.core": "DSH Profile / Bundle",
  "agentCapabilities.dsh.loadMode.plugin": "Cordis Plugin",
  "agentCapabilities.dsh.loadMode.mcp": "MCP Client",
  "agentCapabilities.dsh.executionTarget.dshRuntime": "DSH Runtime",
  "agentCapabilities.dsh.executionTarget.desktopService": "桌面平台服务",
  "agentCapabilities.dsh.executionTarget.externalProcess": "外部隔离进程",
};

export const catalogI18n: PluginCatalogOverlay = { en, "zh-CN": zhCN };
