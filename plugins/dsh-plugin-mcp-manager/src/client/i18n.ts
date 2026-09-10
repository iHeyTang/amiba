import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshMcpToolsTab`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` — the overlay is passed
 * to `usePluginT` and its keys take precedence over the host catalog.
 *
 * Every value below was copied verbatim from the host catalogs at
 * migration time (the host catalogs). Shared
 * `common.*` vocabulary intentionally stays host-side and is NOT copied.
 */
export const mcpI18n: PluginCatalogOverlay = {
  en: {
    "externalTools.mcp.dependencies.instances": "instances",
    "externalTools.mcp.dependencies.error": "Startup failed",
    "externalTools.mcp.dependencies.in-use": "In use",
    "externalTools.mcp.dependencies.available": "Available on request",
    "externalTools.mcp.dependencies.none": "No active consumers",
    "externalTools.mcp.dependencies.consumers": "Used by",
    "externalTools.mcp.dependencies.provider": "Provided by",
    "externalTools.mcp.dependencies.config":
      "Connection settings are maintained by their provider in Connections.",
    "externalTools.mcp.dependencies": "Plugin MCP dependencies",
    "externalTools.mcp.title": "MCP services",
    "externalTools.mcp.add": "Add MCP",
    "externalTools.mcp.emptyTitle": "No MCP services added",
    "externalTools.mcp.dsh.subtitle":
      "Manage MCP service connections and their settings.",
    "externalTools.mcp.dsh.emptyDescription":
      "Connect a local or remote MCP service.",
    "externalTools.mcp.dsh.serverName": "Service name",
    "externalTools.mcp.dsh.args": "One argument per line",
    "externalTools.mcp.dsh.cwd": "Working directory (optional)",
    "externalTools.mcp.dsh.env": "Environment JSON (optional)",
    "externalTools.mcp.dsh.headers": "Headers JSON (optional)",
    "externalTools.mcp.dsh.preserveSecrets":
      "Leave blank to preserve configured secrets: {keys}",
    "externalTools.mcp.dsh.hotReload":
      "Changes take effect after saving.",
    "externalTools.mcp.dsh.saved": "MCP configuration saved",
    "externalTools.mcp.dsh.deleteConfirm": "Remove MCP server “{name}”?",
    "externalTools.status.enabled": "Enabled",
    "externalTools.status.disabled": "Disabled",
  },
  "zh-CN": {
    "externalTools.mcp.dependencies.instances": "个运行实例",
    "externalTools.mcp.dependencies.error": "启动失败",
    "externalTools.mcp.dependencies.in-use": "使用中",
    "externalTools.mcp.dependencies.available": "按需使用",
    "externalTools.mcp.dependencies.none": "暂无使用者",
    "externalTools.mcp.dependencies.consumers": "使用者",
    "externalTools.mcp.dependencies.provider": "提供方",
    "externalTools.mcp.dependencies.config":
      "连接配置由提供方维护，请在连接设置中修改。",
    "externalTools.mcp.dependencies": "插件的 MCP 依赖",
    "externalTools.mcp.title": "MCP 服务",
    "externalTools.mcp.add": "添加 MCP",
    "externalTools.mcp.emptyTitle": "尚未添加 MCP",
    "externalTools.mcp.dsh.subtitle":
      "把MCP 服务作为 DSH 原生 Cordis plugin 加载。DSH 当前只桥接 MCP Tools，不桥接 Resources 或 Prompts。",
    "externalTools.mcp.dsh.emptyDescription":
      "连接本地或远程 MCP 服务。",
    "externalTools.mcp.dsh.serverName": "服务名称",
    "externalTools.mcp.dsh.args": "每行一个参数",
    "externalTools.mcp.dsh.cwd": "工作目录（可选）",
    "externalTools.mcp.dsh.env": "环境变量 JSON（可选）",
    "externalTools.mcp.dsh.headers": "请求头 JSON（可选）",
    "externalTools.mcp.dsh.preserveSecrets":
      "留空以保留已配置的秘密字段：{keys}",
    "externalTools.mcp.dsh.hotReload":
      "保存后配置立即生效。",
    "externalTools.mcp.dsh.saved": "已保存 MCP 配置",
    "externalTools.mcp.dsh.deleteConfirm": "确定移除 MCP 服务“{name}”吗？",
    "externalTools.status.enabled": "已启用",
    "externalTools.status.disabled": "已停用",
  },
};
