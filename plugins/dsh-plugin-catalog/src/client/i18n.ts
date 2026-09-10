import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshAgentCapabilitiesPage`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
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
  "agentCapabilities.group.label": "Delivery",
  "agentCapabilities.group.builtin": "Built-in",
  "agentCapabilities.group.builtin.description": "Tools shipped with the application, regardless of provider.",
  "agentCapabilities.group.user": "User extensions",
  "agentCapabilities.group.user.description": "Tools added through user presets, plugins or MCP connections.",

  "agentCapabilities.mcp.lark": "Feishu / Lark",
  "agentCapabilities.mcp.service": "MCP service",
  "agentCapabilities.mcp.sendMessage": "Send message",
  "agentCapabilities.mcp.searchChat": "Search chats",
  "agentCapabilities.mcp.readDoc": "Read document",
  "agentCapabilities.mcp.searchDoc": "Search documents",
  "agentCapabilities.mcp.importDoc": "Import document",
  "agentCapabilities.mcp.userIds": "Look up users",
  "agentCapabilities.mcp.searchRecords": "Search records",
  "agentCapabilities.mcp.batchCreate": "Create records",
  "agentCapabilities.mcp.callId": "Call ID",
  "agentCapabilities.mcp.tools": "tools",
  "agentCapabilities.mcp.servers": "servers",
  "agentCapabilities.back": "Back to tools",
  "agentCapabilities.dsh.description":
    "Browse built-in tools and user extensions.",
  "agentCapabilities.dsh.empty": "No tools are registered in this runtime.",
  "agentCapabilities.dsh.noDescription": "No tool description provided.",
  "agentCapabilities.dsh.ready": "Registered",
  "agentCapabilities.dsh.schema": "Input schema",
  "agentCapabilities.dsh.schema.description":
    "The JSON Schema DSH sends to the selected model for this tool.",
  "agentCapabilities.dsh.source.filter": "Filter by delivery",
  "agentCapabilities.dsh.source.all": "All",
  "agentCapabilities.dsh.source.empty": "This source has no available tools.",
  "agentCapabilities.dsh.source.dshCore": "Official DSH capabilities",
  "agentCapabilities.dsh.source.dshCore.description":
    "Registered by official plugins across the installed DSH presets.",
  "agentCapabilities.dsh.source.dshPlugin": "Plugin tools",
  "agentCapabilities.dsh.source.dshPlugin.description":
    "Registered through a plugin.",
  "agentCapabilities.dsh.source.mcpServer": "MCP tools",
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
  "agentCapabilities.group.label": "工具类型",
  "agentCapabilities.group.builtin": "内置",
  "agentCapabilities.group.builtin.description": "随应用提供的工具，不区分 DSH 或 Amiba。",
  "agentCapabilities.group.user": "用户扩展",
  "agentCapabilities.group.user.description": "通过用户预设、插件或 MCP 连接添加的工具。",

  "agentCapabilities.mcp.lark": "飞书",
  "agentCapabilities.mcp.service": "MCP 服务",
  "agentCapabilities.mcp.sendMessage": "发送消息",
  "agentCapabilities.mcp.searchChat": "搜索群聊",
  "agentCapabilities.mcp.readDoc": "读取文档",
  "agentCapabilities.mcp.searchDoc": "搜索文档",
  "agentCapabilities.mcp.importDoc": "导入文档",
  "agentCapabilities.mcp.userIds": "查询用户",
  "agentCapabilities.mcp.searchRecords": "搜索多维表记录",
  "agentCapabilities.mcp.batchCreate": "创建多维表记录",
  "agentCapabilities.mcp.callId": "调用 ID",
  "agentCapabilities.mcp.tools": "个工具",
  "agentCapabilities.mcp.servers": "个服务",
  "agentCapabilities.back": "返回工具",
  "agentCapabilities.dsh.description":
    "查看内置工具和用户扩展的工具。",
  "agentCapabilities.dsh.empty": "当前运行时没有注册任何工具。",
  "agentCapabilities.dsh.noDescription": "这个工具没有提供说明。",
  "agentCapabilities.dsh.ready": "已注册",
  "agentCapabilities.dsh.schema": "输入 Schema",
  "agentCapabilities.dsh.schema.description":
    "DSH 针对此工具发送给所选模型的 JSON Schema。",
  "agentCapabilities.dsh.source.filter": "按内置或用户扩展筛选",
  "agentCapabilities.dsh.source.all": "全部",
  "agentCapabilities.dsh.source.empty": "这个来源当前没有可用工具。",
  "agentCapabilities.dsh.source.dshCore": "DSH 官方能力",
  "agentCapabilities.dsh.source.dshCore.description":
    "由已安装 DSH presets 中的官方插件注册。",
  "agentCapabilities.dsh.source.dshPlugin": "插件工具",
  "agentCapabilities.dsh.source.dshPlugin.description":
    "由插件注册的工具。",
  "agentCapabilities.dsh.source.mcpServer": "MCP 工具",
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
